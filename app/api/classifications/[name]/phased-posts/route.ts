import { createClient } from "@/app/lib/supabase-server";
import {
    collectAllChildrenNamesWithLinkedTree,
    collectDirectChildrenNamesOfTarget,
    findRelatedClassifications,
    safeYamlParse,
} from "@/app/lib/yaml-utils";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

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

// 投稿を取得して整形する関数（バッチごとに投稿を返す）
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/app/types/database.types";

async function fetchAndFormatPosts(
    supabase: SupabaseClient<Database>,
	classifications: string[],
	userLikes: string[],
	phase: string,
): Promise<{ posts: FormattedPost[]; batches: FormattedPost[][] }> {
	// 配列を分割するサイズ（Supabaseの制限を考慮）
	const BATCH_SIZE = 100;
	const allPosts: FormattedPost[] = [];
	const batches: FormattedPost[][] = [];

	console.log(`${phase} fetchAndFormatPosts開始: ${classifications.length}個の分類を処理`);
	console.log(`${phase} 処理対象分類:`, classifications);

	// 配列を分割して処理
	for (let i = 0; i < classifications.length; i += BATCH_SIZE) {
		const batch = classifications.slice(i, i + BATCH_SIZE);
		const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
		const batchStartTime = new Date().toISOString();
		
		console.log(
			`${phase} バッチ${batchNumber}開始: ${i + 1}-${Math.min(i + BATCH_SIZE, classifications.length)}/${classifications.length} (${batch.length}個)`,
		);
		console.log(`${phase} バッチ${batchNumber}処理対象:`, batch);

		const { data: posts, error } = await supabase
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
			.in("classification", batch)
			.order("created_at", { ascending: false });

		if (error) {
			console.error(
				`${phase} バッチ${batchNumber} 投稿取得エラー:`,
				error,
			);
			continue; // エラーが発生しても次のバッチを処理
		}

		const formattedPosts =
			posts?.map((post: Post) => ({
				...post,
				user: post.users,
				likeCount: post.likes?.length || 0,
				isLiked: userLikes.includes(post.id),
				images:
					post.post_images?.sort(
						(a: PostImage, b: PostImage) => a.order_index - b.order_index,
					) || [],
			})) || [];

		const batchEndTime = new Date().toISOString();
		console.log(`${phase} バッチ${batchNumber}完了: ${formattedPosts.length}件の投稿を取得 (${batchStartTime} → ${batchEndTime})`);
		console.log(`${phase} バッチ${batchNumber}取得投稿の分類:`, formattedPosts.map((p: FormattedPost) => p.classification));

		allPosts.push(...formattedPosts);
		batches.push(formattedPosts);
	}

	console.log(`${phase} 全バッチ完了: ${allPosts.length}件の投稿を取得（${batches.length}バッチ）`);
	console.log(`${phase} 最終結果の投稿分類:`, allPosts.map((p: FormattedPost) => p.classification));
	return { posts: allPosts, batches };
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	try {
		const { name } = await params;
		const decodedName = decodeURIComponent(name);

		if (!decodedName) {
			return NextResponse.json({ error: "分類名が必要です" }, { status: 400 });
		}

		const supabase = await createClient();

		// 認証ヘッダーを確認
		const authHeader = request.headers.get("Authorization");
		let user = null;
		let userLikes: string[] = [];

		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.split(" ")[1];
			const authSupabase = await createClient(token);
			const {
				data: { user: authUser },
			} = await authSupabase.auth.getUser();
			user = authUser;

			// ユーザーのいいね状態を取得
			if (user) {
				const { data: likes } = await authSupabase
					.from("likes")
					.select("post_id")
					.eq("user_id", user.id);
				userLikes = likes?.map((like) => like.post_id) || [];
			}
		}

		const results = {
			phase1: { posts: [] as FormattedPost[], batches: [] as FormattedPost[][], count: 0, phase: "完全一致" },
			phase2: {
				posts: [] as FormattedPost[],
				batches: [] as FormattedPost[][],
				count: 0,
				phase: "分類ページ系統樹",
			},
			phase3: {
				posts: [] as FormattedPost[],
				batches: [] as FormattedPost[][],
				count: 0,
				phase: "データベース系統樹",
			},
			phase4: { posts: [] as FormattedPost[], batches: [] as FormattedPost[][], count: 0, phase: "Claudeマッチ" },
		};

		// Phase 1: 完全一致の投稿を取得
		console.log("=== Phase 1: 完全一致の投稿を取得 ===");
		const { posts: phase1Posts, batches: phase1Batches } = await fetchAndFormatPosts(
			supabase,
			[decodedName],
			userLikes,
			"Phase 1",
		);
		results.phase1.posts = phase1Posts;
		results.phase1.count = phase1Posts.length;
		results.phase1.batches = phase1Batches;
		console.log(`Phase 1 完了: ${phase1Posts.length}件の投稿を取得`);

		// Phase 2: 分類ページに紐づけられている系統樹から子要素を取得（常に実行）
		console.log("=== Phase 2: 分類ページ系統樹から子要素を取得 ===");
		console.log("Phase 2 開始時刻:", new Date().toISOString());
		let hasLinkedTree = false;
		const { data: classification, error: classificationError } = await supabase
			.from("classifications")
			.select("id")
			.eq("name", decodedName)
			.single();
		if (classificationError) {
			console.error("Phase 2: 分類名取得エラー:", classificationError);
		}
		console.log("Phase 2: classification:", classification);

		if (classification) {
			const { data: phylogeneticTree, error: treeError } = await supabase
				.from("phylogenetic_trees")
				.select("content")
				.eq("classification_id", classification.id)
				.single();
			if (treeError) {
				console.error("Phase 2: 系統樹取得エラー:", treeError);
			}
			console.log("Phase 2: phylogeneticTree取得完了");

			if (phylogeneticTree?.content) {
				hasLinkedTree = true;
				const treeData = safeYamlParse(phylogeneticTree.content);
				console.log("Phase 2: treeData:", treeData);
				if (treeData) {
					// linked_tree対応の子要素収集
					console.log("Phase 2: collectAllChildrenNamesWithLinkedTree開始");
					const children = await collectAllChildrenNamesWithLinkedTree(
						treeData,
						supabase,
					);
					console.log(
						"Phase 2: collectAllChildrenNamesWithLinkedTree result:",
						children,
					);
					if (children.length > 0) {
						console.log(
							`Phase 2: ${children.length}個の子要素を発見:`,
							children,
						);
						console.log("Phase 2: fetchAndFormatPosts開始時刻:", new Date().toISOString());
						const { posts: phase2Posts, batches: phase2Batches } = await fetchAndFormatPosts(
							supabase,
							children,
							userLikes,
							"Phase 2",
						);
						console.log("Phase 2: fetchAndFormatPosts完了時刻:", new Date().toISOString());
						console.log("Phase 2: fetchAndFormatPosts result:", phase2Posts);
						console.log("Phase 2: バッチ数:", phase2Batches.length);
						console.log("Phase 2: 各バッチの投稿数:", phase2Batches.map((batch, index) => `バッチ${index + 1}: ${batch.length}件`));
						
						results.phase2.posts = phase2Posts;
						results.phase2.count = phase2Posts.length;
						results.phase2.batches = phase2Batches;
						console.log(`Phase 2 完了: ${phase2Posts.length}件の投稿を取得`);
					} else {
						console.log("Phase 2: 子要素が見つかりませんでした");
					}
				} else {
					console.log("Phase 2: treeDataがnullです");
				}
			} else {
				console.log("Phase 2: phylogeneticTree.contentがありません");
			}
		} else {
			console.log("Phase 2: classificationがありません");
		}

        // Phase 3: データベース系統樹から関連分類名を取得（Phase 2で系統樹が設定されていない場合のみ実行）
		if (!hasLinkedTree) {
			console.log("Phase 2で系統樹が設定されていないため、Phase 3を実行");
			console.log("=== Phase 3: データベース系統樹から関連分類名を取得 ===");
			const { data: phylogeneticTrees } = await supabase
				.from("phylogenetic_trees")
				.select("id, content, classification_id")
				.ilike("content", `%${decodedName}%`);

			if (phylogeneticTrees && phylogeneticTrees.length > 0) {
				const allChildren: string[] = [];

				for (const tree of phylogeneticTrees) {
					try {
						const treeData = safeYamlParse(tree.content);
						if (treeData) {
                            // ターゲット名に一致するノードを見つけ、その部分木に対して
                            // Phase 2 同様の link_only/linked_tree ルールで子要素名を収集
                            const children = await collectDirectChildrenNamesOfTarget(
                                treeData,
                                decodedName,
                                supabase,
                            );
							for (const child of children) {
								if (!allChildren.includes(child)) {
									allChildren.push(child);
								}
							}
						}
					} catch (error) {
						console.error(`系統樹データの処理エラー (ID: ${tree.id}):`, error);
					}
				}

				if (allChildren.length > 0) {
					console.log(
						`Phase 3: ${allChildren.length}個の関連分類名を発見:`,
						allChildren,
					);
					const { posts: phase3Posts, batches: phase3Batches } = await fetchAndFormatPosts(
						supabase,
						allChildren,
						userLikes,
						"Phase 3",
					);
					results.phase3.posts = phase3Posts;
					results.phase3.count = phase3Posts.length;
					results.phase3.batches = phase3Batches;
					console.log(`Phase 3 完了: ${phase3Posts.length}件の投稿を取得`);
				}
			}
		} else {
			console.log("Phase 2で系統樹が設定されているため、Phase 3はスキップ");
		}

		// Phase 4: Claudeマッチ（Phase 2で系統樹が設定されていない場合のみ実行）
		if (!hasLinkedTree) {
			console.log("Phase 2で系統樹が設定されていないため、Phase 4を実行");
			console.log("=== Phase 4: Claudeマッチ ===");
			try {
				// すべての投稿からclassificationを取得
				const { data: allPosts } = await supabase
					.from("posts")
					.select("classification")
					.not("classification", "is", null);

				if (allPosts && allPosts.length > 0) {
					// 重複を除去した分類名の配列を作成し、検索対象の分類名を除外
					const classifications = Array.from(
						new Set(allPosts.map((post) => post.classification)),
					)
						.filter(Boolean)
						.filter((name) => name !== decodedName) as string[];

					if (classifications.length > 0) {
						// Claude APIに分類名と配列を送信
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

						const response =
							message.content[0].type === "text" ? message.content[0].text : "";
						const jsonMatch = response.match(/\{[\s\S]*\}/);

						if (jsonMatch) {
							const parsedResponse: { matchedClassifications?: string[] } =
								JSON.parse(jsonMatch[0]);
							const matchedClassifications: string[] =
								parsedResponse.matchedClassifications || [];

							if (matchedClassifications.length > 0) {
								console.log(
									`Phase 4: Claude APIで${matchedClassifications.length}個の分類名をマッチ:`,
									matchedClassifications,
								);
								const { posts: phase4Posts, batches: phase4Batches } = await fetchAndFormatPosts(
									supabase,
									matchedClassifications,
									userLikes,
									"Phase 4",
								);
								results.phase4.posts = phase4Posts;
								results.phase4.count = phase4Posts.length;
								results.phase4.batches = phase4Batches;
								console.log(
									`Phase 4 完了: ${phase4Posts.length}件の投稿を取得`,
								);
							}
						}
					}
				}
			} catch (error) {
				console.error("Phase 4 Claude API エラー:", error);
			}
		} else {
			console.log("Phase 2で系統樹が設定されているため、Phase 4はスキップ");
		}

		// 全フェーズの結果を統合（重複を除去）
		const allPosts = new Map<string, FormattedPost>();

		// Phase 1の投稿を追加
		for (const post of results.phase1.posts) {
			allPosts.set(post.id, post);
		}

		// Phase 2の投稿を追加（重複しないもののみ）
		for (const post of results.phase2.posts) {
			if (!allPosts.has(post.id)) {
				allPosts.set(post.id, post);
			}
		}

		// Phase 3の投稿を追加（重複しないもののみ）
		for (const post of results.phase3.posts) {
			if (!allPosts.has(post.id)) {
				allPosts.set(post.id, post);
			}
		}

		// Phase 4の投稿を追加（重複しないもののみ）
		for (const post of results.phase4.posts) {
			if (!allPosts.has(post.id)) {
				allPosts.set(post.id, post);
			}
		}

		const finalPosts = Array.from(allPosts.values()).sort(
			(a, b) =>
				new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
		);

		console.log("=== 全フェーズ完了 ===");
		console.log("最終投稿数:", finalPosts.length);
		console.log("フェーズ別結果:", results);

		return NextResponse.json({
			posts: finalPosts,
			phaseResults: results,
			totalCount: finalPosts.length,
		});
	} catch (error) {
		console.error("Phased posts API error:", error);
		return NextResponse.json({ error: "内部サーバーエラー" }, { status: 500 });
	}
}
