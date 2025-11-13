import { createClient } from "@/app/lib/supabase-server";
import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/app/types/database.types";

const anthropic = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY,
});

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
		const { searchParams } = new URL(request.url);
		const includePosts = searchParams.get("includePosts") === "true";

		if (!decodedName) {
			return NextResponse.json(
				{ error: "Classification name is required" },
				{ status: 400 },
			);
		}

		// 認証ヘッダーを確認
		const authHeader = request.headers.get("Authorization");
		let supabase: SupabaseClient<Database>;
		let user = null;

		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.split(" ")[1];
			// 認証トークン付きでSupabaseクライアントを作成
			supabase = await createClient(token);
			const {
				data: { user: authUser },
			} = await supabase.auth.getUser();
			user = authUser;
		} else {
			// 認証なしでSupabaseクライアントを作成
			supabase = await createClient();
		}

		// 分類情報を取得（存在しない場合はnull）
		const { data: classification, error: classificationError } = await supabase
			.from("classifications")
			.select("*")
			.eq("name", decodedName)
			.single();

		// 分類が見つからない場合はエラーにせず、nullとして扱う
		if (classificationError && classificationError.code !== "PGRST116") {
			throw classificationError;
		}

		// 投稿データの取得が必要な場合のみ実行
		let posts: FormattedPost[] = [];
		if (includePosts) {
			// 1. まず完全一致する投稿を取得
			const { data: exactMatchPosts, error: exactMatchError } = await supabase
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
				.eq("classification", decodedName)
				.order("created_at", { ascending: false });

			if (exactMatchError) {
				throw exactMatchError;
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

			// 完全一致する投稿を整形
			const exactMatchFormattedPosts =
				exactMatchPosts?.map((post: Post) => ({
					...post,
					user: post.users, // usersをuserにリネーム
					likeCount: post.likes?.length || 0,
					isLiked: userLikes.includes(post.id),
					images:
						post.post_images?.sort(
							(a: PostImage, b: PostImage) => a.order_index - b.order_index,
						) || [],
				})) || [];

			posts = exactMatchFormattedPosts;

			console.log("=== 完全一致投稿の取得完了 ===");
			console.log("完全一致する投稿の数:", exactMatchFormattedPosts.length);

			// 2. バックグラウンドでClaude APIを使用して関連する投稿を取得
			// 非同期で実行し、結果を待たずにレスポンスを返す
			setTimeout(async () => {
				try {
					// すべての投稿からclassificationを取得
					const { data: allPosts, error: allPostsError } = await supabase
						.from("posts")
						.select("classification")
						.not("classification", "is", null);

					if (allPostsError) {
						console.error("All posts fetch error:", allPostsError);
						return;
					}

					// 重複を除去した分類名の配列を作成し、検索対象の分類名を除外
					const classifications = Array.from(
						new Set(allPosts.map((post) => post.classification)),
					)
						.filter(Boolean)
						.filter((name) => name !== decodedName) as string[];

					console.log("=== Claude API バックグラウンド処理開始 ===");
					console.log("検索対象の分類名:", decodedName);
					console.log("除外後の分類名数:", classifications.length);

					if (classifications.length === 0) {
						console.log("処理対象の分類名がありません");
						return;
					}

					// Claude APIに分類名と配列を送信して階層関係を考慮した分類を取得（リトライ機能付き）
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

							// 過負荷エラー（529）またはレート制限エラーの場合、リトライ
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
								); // 指数バックオフ
								return callClaudeAPI(retryCount + 1);
							}

							// 最大リトライ回数に達した場合、エラーを投げる
							throw error;
						}
					};

					const message = await callClaudeAPI();

					// Claude APIの応答をパース
					const response =
						message.content[0].type === "text" ? message.content[0].text : "";

					console.log("Claude APIの生の応答:", response);

					// JSONの部分を抽出（余分なテキストがある場合に対応）
					const jsonMatch = response.match(/\{[\s\S]*\}/);
					if (!jsonMatch) {
						console.error("No JSON found in response:", response);
						return;
					}

					const parsedResponse: { matchedClassifications?: string[] } =
						JSON.parse(jsonMatch[0]);
					const matchedClassifications: string[] =
						parsedResponse.matchedClassifications || [];

					console.log(
						"Claude APIから返されたマッチした分類名:",
						matchedClassifications,
					);
					console.log("マッチした分類名の数:", matchedClassifications.length);

					if (
						Array.isArray(matchedClassifications) &&
						matchedClassifications.length > 0
					) {
						// マッチした分類名を持つ投稿を取得
						const { data: relatedPostsData, error: relatedPostsError } =
							await supabase
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
							console.error("Related posts fetch error:", relatedPostsError);
							return;
						}

						console.log(
							"Claude APIで取得された関連投稿の数:",
							relatedPostsData?.length || 0,
						);
						console.log("=== Claude API バックグラウンド処理完了 ===");
					}
				} catch (error) {
					console.error("Background Claude API processing error:", error);
				}
			}, 0); // 即座に実行
		}

		return NextResponse.json(
			{
				classification: classification || null,
				posts: posts,
			},
			{
				headers: {
					"Cache-Control": "public, max-age=300, s-maxage=300", // 5分間キャッシュ
				},
			},
		);
	} catch (error) {
		console.error("Classification API error:", error);
		return NextResponse.json(
			{ error: "Internal Server Error" },
			{ status: 500 },
		);
	}
}

export async function PUT(
	request: NextRequest,
	{ params }: { params: Promise<{ name: string }> },
) {
	try {
		const { name } = await params;
		const decodedName = decodeURIComponent(name);
		const body = await request.json();

		if (!decodedName) {
			return NextResponse.json(
				{ error: "Classification name is required" },
				{ status: 400 },
			);
		}

		// Authorizationヘッダーからアクセストークンを取得
		const authHeader = request.headers.get("authorization");
		const accessToken = authHeader?.replace("Bearer ", "");

		if (!accessToken) {
			return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
		}

		// アクセストークンを使ってSupabaseクライアントを作成
		const supabase = await createClient(accessToken);

		// ユーザー情報を取得
		const {
			data: { user },
			error: authError,
		} = await supabase.auth.getUser();
		if (authError || !user) {
			return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
		}

		// 分類が存在するかチェック
		const { data: existingClassification, error: checkError } = await supabase
			.from("classifications")
			.select("id")
			.eq("name", decodedName)
			.single();

		let classification: unknown;
		let operationError: unknown;

		if (checkError && checkError.code === "PGRST116") {
			// 分類が存在しない場合は作成
			const insertPayload = {
				name: decodedName,
				english_name: body.english_name || decodedName,
				scientific_name: body.scientific_name || "",
				description: body.description || "",
				appearance_period: body.appearance_period || null,
				extinction_period: body.extinction_period || null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			} as const;

			const { data: newClassification, error: createError } = await supabase
				.from("classifications")
				.insert(insertPayload)
				.select()
				.single();

			classification = newClassification;
			operationError = createError;
		} else if (checkError) {
			// その他のエラーの場合
			console.error("Classification check error:", checkError);
			return NextResponse.json(
				{ error: "Failed to check classification" },
				{ status: 500 },
			);
		} else {
			// 分類が存在する場合は更新
			// 既存データを取得
			const { data: currentClassification } = await supabase
				.from("classifications")
				.select("id")
				.eq("name", decodedName)
				.single();

			const updatePayload: Record<string, unknown> = {
				english_name: body.english_name,
				scientific_name: body.scientific_name,
				description: body.description,
				appearance_period: body.appearance_period,
				extinction_period: body.extinction_period,
				updated_at: new Date().toISOString(),
			};

			const { data: updatedClassification, error: updateError } = await supabase
				.from("classifications")
				.update(updatePayload)
				.eq("name", decodedName)
				.select()
				.single();

			classification = updatedClassification;
			operationError = updateError;
		}

		if (operationError) {
			console.error("Classification update error:", operationError);
			return NextResponse.json(
				{ error: "Failed to update classification" },
				{ status: 500 },
			);
		}

		return NextResponse.json({ classification });
	} catch (error) {
		console.error("Classification API error:", error);
		return NextResponse.json(
			{ error: "Internal Server Error" },
			{ status: 500 },
		);
	}
}
