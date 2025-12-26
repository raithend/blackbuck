import { createClient } from "@/app/lib/supabase-server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ accountId: string }> },
) {
	try {
		const { accountId } = await params;

		if (!accountId) {
			return NextResponse.json(
				{ error: "Account ID is required" },
				{ status: 400 },
			);
		}

		// Supabaseクライアントを作成
		const supabase = await createClient();

		// Authorizationヘッダーを確認（認証は任意）
		const authHeader = request.headers.get("Authorization");

		// まずユーザー情報を取得
		const { data: user, error: userError } = await supabase
			.from("users")
			.select("*")
			.eq("account_id", accountId)
			.single();

		if (userError || !user) {
			return NextResponse.json({ error: "User not found" }, { status: 404 });
		}

		// クエリパラメータを取得
		const { searchParams } = new URL(request.url);
		const limit = Number.parseInt(searchParams.get("limit") || "50");
		const offset = Number.parseInt(searchParams.get("offset") || "0");

		// ユーザーの投稿を取得（画像も含む）
		const { data: posts, error: postsError } = await supabase
			.from("posts")
			.select(`
				*,
				post_images (
					id,
					image_url,
					order_index
				)
			`)
			.eq("user_id", user.id)
			.order("created_at", { ascending: false })
			.range(offset, offset + limit - 1);

		if (postsError) {
			return NextResponse.json({ error: postsError.message }, { status: 500 });
		}

		// 各投稿のいいね数を取得
		const postIds = posts?.map((post) => post.id) || [];
		const { data: likeCounts, error: likeCountsError } = await supabase
			.from("likes")
			.select("post_id")
			.in("post_id", postIds);

		// いいね数を集計
		const likeCountMap = new Map<string, number>();
		for (const like of likeCounts || []) {
			const count = likeCountMap.get(like.post_id) || 0;
			likeCountMap.set(like.post_id, count + 1);
		}

		// 各投稿のコメント数を取得
		const { data: commentCounts, error: commentCountsError } = await supabase
			.from("comments")
			.select("post_id")
			.in("post_id", postIds);

		if (commentCountsError) {
			console.error("コメント数取得エラー:", commentCountsError);
		}

		// コメント数を集計
		const commentCountMap = new Map<string, number>();
		for (const comment of commentCounts || []) {
			if (comment.post_id) {
				const count = commentCountMap.get(comment.post_id) || 0;
				commentCountMap.set(comment.post_id, count + 1);
			}
		}

		// 認証済みユーザーの場合、いいね状態も取得
		let currentUser = null;
		let userLikes: string[] = [];

		// Authorizationヘッダーからトークンを取得（認証は任意）
		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.split(" ")[1];
			const {
				data: { user: authUser },
				error: authError,
			} = await supabase.auth.getUser(token);

			if (authUser && !authError) {
				currentUser = authUser;

				const { data: likes, error: likesError } = await supabase
					.from("likes")
					.select("post_id")
					.eq("user_id", authUser.id);

				if (!likesError) {
					userLikes = likes?.map((like) => like.post_id) || [];
				}
			}
		}

		// 投稿データを整形（ユーザー情報といいね情報を含める）
		const formattedPosts =
			posts?.map((post) => {
				const isLiked = userLikes.includes(post.id);
				const likeCount = likeCountMap.get(post.id) || 0;
				const commentCount = commentCountMap.get(post.id) || 0;

				return {
					...post,
					user: user,
					post_images:
						post.post_images?.sort((a, b) => a.order_index - b.order_index) ||
						[],
					likeCount,
					commentCount,
					isLiked,
				};
			}) || [];

		return NextResponse.json({ posts: formattedPosts });
	} catch (error) {
		return NextResponse.json(
			{ error: "Internal Server Error" },
			{ status: 500 },
		);
	}
}
