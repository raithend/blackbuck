import { createClient } from "@/app/lib/supabase-server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ name: string }> },
) {
	try {
		const { name } = await params;
		const decodedName = decodeURIComponent(name);

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

		// Claude APIの設定
		const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
		if (!ANTHROPIC_API_KEY) {
			return NextResponse.json(
				{ error: "Claude APIキーが設定されていません" },
				{ status: 500 },
			);
		}

		// WikipediaのURLを構築
		const wikipediaUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(decodedName)}`;
		console.log("Wikipedia URL:", wikipediaUrl);

		// Claude APIに送信するプロンプト
		const prompt = `以下のWikipediaページから系統樹データを抽出し、YAML形式で返してください：

URL: ${wikipediaUrl}

以下の形式でYAMLデータを作成してください：
- ページ内の「分類」「系統」「分類学的位置」「分類学」「分類表」などのセクションから情報を抽出
- 階層構造を表現するため、childrenを使用
- 各分類群の名前をnameフィールドに設定
- 適切なインデントで階層を表現
- 分類階級（門、綱、目、科、属、種など）を考慮して階層を構築

例：
name: ワニ目
children:
  - name: アリゲーター科
    children:
      - name: アリゲーター亜科
        children:
          - name: アメリカアリゲーター
          - name: ヨウスコウアリゲーター
      - name: カイマン亜科
        children:
          - name: メガネカイマン
          - name: コビトカイマン
  - name: Longirostres
    children: 
      - name: クロコダイル科
        children:
          - name: クロコダイル属
            children:
              - name: イリエワニ
              - name: ナイルワニ
              - name: シャムワニ
      - name: ガビアル科
        children: 
          - name: インドガビアル属
            children:
              - name: インドガビアル
          - name: マレーガビアル属
            children:
              - name: マレーガビアル
          - name: トミストマ亜科
            children: 
              - name: マチカネワニ

注意：
- 日本語の分類名を優先的に使用
- 日本語名が存在しない場合は、英語名をそのまま使用（翻訳しない）
- 英語名を使用する場合は、日本語の分類階級（目、科、属、種など）を付け足さない
- 例：英語名「Primates」の場合、「Primates目」ではなく「Primates」と表記
- 例：英語名「Hominidae」の場合、「Hominidae科」ではなく「Hominidae」と表記
- 階層構造を正確に表現
- 不要な情報は除外
- 純粋なYAML形式のみを返す（説明文は含めない）
- 分類情報が見つからない場合は、基本的な分類構造を提案する
- 各分類群は適切な階層レベルで配置する
- 英語名を使用する場合は、そのまま英語表記を維持する

予約語の使用：
- linked_tree: 他の系統樹を参照する場合に使用（UUIDを指定）
- non_post_leaf: リーフノードだが投稿取得時に無視したい場合にtrueを設定
- post_branch: 非リーフノードだが投稿取得に含めたい場合にtrueを設定
- link_only: この系統樹はlinked_treeのみを参照し、自身のnameは投稿取得対象にしない場合にtrueを設定`;

		// Claude APIにリクエスト
		const claudeResponse = await fetch(
			"https://api.anthropic.com/v1/messages",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": ANTHROPIC_API_KEY,
					"anthropic-version": "2023-06-01",
				},
				body: JSON.stringify({
					model: "claude-sonnet-4-5-20250929",
					max_tokens: 4000,
					temperature: 0.1,
					messages: [
						{
							role: "user",
							content: prompt,
						},
					],
				}),
			},
		);

		if (!claudeResponse.ok) {
			const errorText = await claudeResponse.text();
			console.error("Claude API error:", errorText);
			return NextResponse.json(
				{
					error: "Claude APIからの応答に失敗しました",
					details: errorText,
				},
				{ status: 500 },
			);
		}

		const claudeData = await claudeResponse.json();
		const generatedYaml = claudeData.content[0].text;

		// YAMLの妥当性をチェック（基本的なチェック）
		if (
			!generatedYaml.includes("name:") ||
			!generatedYaml.includes("children:")
		) {
			return NextResponse.json(
				{
					error: "生成されたデータが正しいYAML形式ではありません",
					generatedContent: generatedYaml,
				},
				{ status: 400 },
			);
		}

		// 分類IDを取得（保存用、なくてもエラーにしない、複数レコードの可能性を考慮）
		const { data: classifications } = await supabase
			.from("classifications")
			.select("id")
			.eq("name", decodedName);

		// 複数のレコードが存在する場合、最初のレコードを使用
		const classification =
			classifications && classifications.length > 0
				? classifications[0]
				: null;
		if (classifications && classifications.length > 1) {
			console.warn(
				`複数のレコードが存在します: ${decodedName} (${classifications.length}件)。最初のレコードを使用します。`,
			);
		}

		if (classification) {
			// 生成されたYAMLをphylogenetic_treesテーブルにupsert
			const { error: upsertError } = await supabase
				.from("phylogenetic_trees")
				.upsert(
					{
						classification_id: classification.id,
						content: generatedYaml,
						creator: user.id,
						updated_at: new Date().toISOString(),
					},
					{ onConflict: "classification_id" },
				);

			if (upsertError) {
				console.error("系統樹データ保存エラー:", upsertError);
				// 保存エラーは警告として返すが、生成データは返す
				return NextResponse.json({
					warning: "系統樹データの保存に失敗しました",
					yaml: generatedYaml,
					message: "Wikipediaから系統樹データを生成しました（保存は失敗）",
					source: wikipediaUrl,
				});
			}
		}

		// 分類がなくても生成データは返す
		return NextResponse.json({
			success: true,
			yaml: generatedYaml,
			message: "Wikipediaから系統樹データを生成しました",
			source: wikipediaUrl,
		});
	} catch (error) {
		console.error("系統樹生成エラー:", error);
		return NextResponse.json(
			{
				error: "系統樹の生成に失敗しました",
				details: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
}
