import { createClient } from "@/app/lib/supabase-server";
import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const anthropic = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY,
});

// Claude API content型を明示
interface ClaudeContent {
	type: string;
	text?: string;
}

interface PostImage {
	id: string;
	image_url: string;
	order_index: number;
}

interface PostUser {
	id: string;
	username: string;
	avatar_url: string | null;
	account_id: string | null;
	bio: string | null;
	created_at: string;
	header_url: string | null;
	updated_at: string;
}

interface Post {
	id: string;
	classification: string | null;
	content: string;
	created_at: string;
	event: string | null;
	location: string | null;
	updated_at: string;
	user_id: string;
	users: PostUser;
	post_images: PostImage[];
	likes: { id: string }[];
}

interface FormattedPost {
	id: string;
	classification: string | null;
	content: string;
	created_at: string;
	event: string | null;
	location: string | null;
	updated_at: string;
	user_id: string;
	user: PostUser;
	likeCount: number;
	isLiked: boolean;
	images: PostImage[];
}

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ name: string }> },
) {
	try {
		const { name } = await params;
		const decodedName = decodeURIComponent(name);
		if (!decodedName) {
			return NextResponse.json(
				{ error: "Classification name is required" },
				{ status: 400 },
			);
		}

		// 認証ヘッダーを確認
		const authHeader = request.headers.get("Authorization");
		let supabase;
		let user = null;

		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.split(" ")[1];
			supabase = await createClient(token);
			const {
				data: { user: authUser },
			} = await supabase.auth.getUser();
			user = authUser;
		} else {
			supabase = await createClient();
		}

		// すべての投稿からclassificationを取得
		const { data: allPosts, error: allPostsError } = await supabase
			.from("posts")
			.select("classification")
			.not("classification", "is", null);

		if (allPostsError) {
			return NextResponse.json(
				{ error: "Failed to fetch posts" },
				{ status: 500 },
			);
		}

		// 重複を除去した分類名の配列を作成し、検索対象の分類名を除外
		const classifications = Array.from(
			new Set(allPosts.map((post) => post.classification)),
		)
			.filter(Boolean)
			.filter((name) => name !== decodedName) as string[];

		if (classifications.length === 0) {
			return NextResponse.json({ relatedPosts: [] });
		}

		// Claude APIで関連分類名を取得
		const callClaudeAPI = async (
			retryCount = 0,
		): Promise<Anthropic.Messages.Message> => {
			try {
				const message = await anthropic.messages.create({
					model: "claude-sonnet-4-5-20250929",
					max_tokens: 1000,
					messages: [
						{
							role: "user",
							content: `あなたは生物分類の専門家です。以下の分類名のリストから、「${decodedName}」に属する生物名のみを抽出してください。

必ず以下の形式のJSONで返答してください：
{"matchedClassifications": ["分類名1", "分類名2", ...]}

分類名が見つからない場合は空配列を返してください：
{"matchedClassifications": []}

分類名リスト：
${JSON.stringify(classifications)}`,
						},
					],
				});
				return message;
			} catch (error: unknown) {
				console.error(
					`Claude API呼び出しエラー (試行 ${retryCount + 1}):`,
					error,
				);
				if (
					error &&
					typeof error === "object" &&
					"status" in error &&
					(error.status === 529 || error.status === 429) &&
					retryCount < 3
				) {
					console.log(`リトライ中... (${retryCount + 1}/3)`);
					await new Promise((resolve) =>
						setTimeout(resolve, 2000 * (retryCount + 1)),
					);
					return callClaudeAPI(retryCount + 1);
				}
				throw error;
			}
		};

		const message = await callClaudeAPI();
		// Claude APIの返答型を明示的に扱う
		const contentArr = message.content as ClaudeContent[];
		const contentItem = contentArr[0];
		const response = contentItem.type === "text" ? contentItem.text ?? "" : "";
		const jsonMatch: string[] | null = response.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			return NextResponse.json({ relatedPosts: [] });
		}
		const parsedResponse: { matchedClassifications?: string[] } = JSON.parse(
			jsonMatch[0],
		);
		const matchedClassifications: string[] =
			parsedResponse.matchedClassifications || [];

		if (
			!Array.isArray(matchedClassifications) ||
			matchedClassifications.length === 0
		) {
			return NextResponse.json({ relatedPosts: [] });
		}

		// 関連分類名の投稿を取得
		const { data: relatedPostsData, error: relatedPostsError } = await supabase
			.from("posts")
			.select(`
        *,
        users!posts_user_id_fkey (
          id,
          username,
          avatar_url,
          account_id,
          bio,
          created_at,
          header_url,
          updated_at
        ),
        post_images (
          id,
          image_url,
          order_index
        ),
        likes (
          id
        )
      `)
			.in("classification", matchedClassifications)
			.order("created_at", { ascending: false });

		if (relatedPostsError) {
			return NextResponse.json(
				{ error: "Failed to fetch related posts" },
				{ status: 500 },
			);
		}

		// 認証済みユーザーの場合、いいね状態を取得
		let userLikes: string[] = [];
		if (user) {
			const { data: likes, error: likesError } = await supabase
				.from("likes")
				.select("post_id")
				.eq("user_id", user.id);
			if (!likesError) {
				userLikes = likes?.map((like) => like.post_id) || [];
			}
		}

		// 投稿データを整形
		const relatedPosts: FormattedPost[] =
			relatedPostsData?.map((post: Post) => ({
				...post,
				user: post.users,
				likeCount: post.likes?.length || 0,
				isLiked: userLikes.includes(post.id),
				images:
					post.post_images?.sort(
						(a: PostImage, b: PostImage) => a.order_index - b.order_index,
					) || [],
			})) || [];

		return NextResponse.json({ relatedPosts });
	} catch (error) {
		console.error("RelatedPosts API error:", error);
		return NextResponse.json(
			{ error: "Internal Server Error" },
			{ status: 500 },
		);
	}
}
