import { createClient } from "@/app/lib/supabase-server";
import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const anthropic = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * 分類検索API
 * 用途: 検索機能で分類名の部分一致検索を行う
 * パラメータ: name (検索したい分類名)
 * 戻り値: マッチした分類の投稿一覧
 *
 * 注意: 詳細情報が必要な場合は /api/classifications/[name] を使用してください
 */
export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const name = searchParams.get("name");

		if (!name) {
			return NextResponse.json(
				{ error: "Classification name is required" },
				{ status: 400 },
			);
		}

		const decodedName = decodeURIComponent(name);
		const supabase = await createClient();

		// 1. すべての投稿からclassificationを取得
		const { data: allPosts, error: classificationError } = await supabase
			.from("posts")
			.select("classification")
			.not("classification", "is", null);

		if (classificationError) {
			throw classificationError;
		}

		// 重複を除去した分類名の配列を作成
		const classifications = Array.from(
			new Set(allPosts.map((post) => post.classification)),
		).filter(Boolean) as string[];

		// 2. Claude APIに分類名と配列を送信
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

		// Claude APIの応答をパース
		const response =
			message.content[0].type === "text" ? message.content[0].text : "";

		// JSONの部分を抽出（余分なテキストがある場合に対応）
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			console.error("No JSON found in response:", response);
			return NextResponse.json({ posts: [] });
		}

		const parsedResponse = JSON.parse(jsonMatch[0]);
		const matchedClassifications = parsedResponse.matchedClassifications;

		if (!Array.isArray(matchedClassifications)) {
			console.error("Invalid response format:", parsedResponse);
			return NextResponse.json({ posts: [] });
		}

		// 3. マッチした分類名を持つ投稿を取得
		const { data: posts, error: postsError } = await supabase
			.from("posts")
			.select(`
        *,
        user:users (
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
        )
      `)
			.in("classification", matchedClassifications)
			.order("created_at", { ascending: false });

		if (postsError) {
			throw postsError;
		}

		return NextResponse.json(
			{ posts },
			{
				headers: {
					"Cache-Control": "public, s-maxage=300, stale-while-revalidate=600", // 5分間キャッシュ
				},
			},
		);
	} catch (error) {
		console.error("Error processing classifications:", error);
		return NextResponse.json(
			{ error: "Failed to process classifications" },
			{ status: 500 },
		);
	}
}

/**
 * 分類情報作成API
 * 用途: 新しい分類情報を作成する
 */
export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const { name, ...classificationData } = body;

		if (!name) {
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

		// 分類情報を作成
		const { data: classification, error: createError } = await supabase
			.from("classifications")
			.insert({
				name,
				english_name: classificationData.english_name,
				scientific_name: classificationData.scientific_name,
				description: classificationData.description,
				appearance_period: classificationData.appearance_period,
				extinction_period: classificationData.extinction_period,
			})
			.select()
			.single();

		if (createError) {
			console.error("Classification creation error:", createError);
			return NextResponse.json(
				{ error: "Failed to create classification" },
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
