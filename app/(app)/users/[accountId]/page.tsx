"use client";

import { CommentCards } from "@/app/components/comment/comment-cards";
import { UserCards } from "@/app/components/follow/user-cards";
import { PostCards } from "@/app/components/post/post-cards";
import { ProfileHeader } from "@/app/components/profile/profile-header";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { useUser } from "@/app/contexts/user-context";
import type { PostWithUser, User } from "@/app/types/types";
import { useEffect, useState, useRef, useCallback } from "react";
import useSWR from "swr";

// フェッチャー関数
const fetcher = async (url: string) => {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error("Failed to fetch data");
		}
		return response.json();
	} catch (error) {
		// ネットワークエラーの場合は既存データを保持するため、エラーを投げない
		if (error instanceof TypeError && error.message.includes("fetch")) {
			console.warn(
				"ネットワークエラーが発生しましたが、既存のデータを表示し続けます:",
				error,
			);
			return null; // nullを返すことで、既存のデータを保持
		}
		throw error;
	}
};

// 認証付きフェッチャー関数
const authFetcher = async (url: string) => {
	try {
		const supabase = await import("@/app/lib/supabase-browser").then((m) =>
			m.createClient(),
		);
		const {
			data: { session },
		} = await supabase.auth.getSession();

		const headers: HeadersInit = {
			"Content-Type": "application/json",
		};

		if (session?.access_token) {
			headers.Authorization = `Bearer ${session.access_token}`;
		}

		const response = await fetch(url, { headers });
		if (!response.ok) {
			throw new Error("Failed to fetch data");
		}
		return response.json();
	} catch (error) {
		// ネットワークエラーの場合は既存データを保持するため、エラーを投げない
		if (error instanceof TypeError && error.message.includes("fetch")) {
			console.warn(
				"ネットワークエラーが発生しましたが、既存のデータを表示し続けます:",
				error,
			);
			return null; // nullを返すことで、既存のデータを保持
		}
		throw error;
	}
};

export default function UserProfilePage({
	params,
}: { params: Promise<{ accountId: string }> }) {
	const [accountId, setAccountId] = useState<string | null>(null);
	const { user: currentUser } = useUser();
	
	// 無限スクロール用の状態
	const [postsPage, setPostsPage] = useState(0);
	const [allPosts, setAllPosts] = useState<PostWithUser[]>([]);
	const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
	const [hasMorePosts, setHasMorePosts] = useState(true);
	const postsObserverTarget = useRef<HTMLDivElement>(null);

	// paramsを非同期で取得
	useEffect(() => {
		const getAccountId = async () => {
			const { accountId: id } = await params;
			setAccountId(id);
		};
		getAccountId();
	}, [params]);

	// 自分自身のプロフィールかどうかを判定
	const isOwnProfile = currentUser?.account_id === accountId;

	// ユーザー情報を取得
	const {
		data: userData,
		error: userError,
		isLoading: userLoading,
		mutate: mutateUser,
	} = useSWR<{ user: User }>(
		accountId ? `/api/users/account/${accountId}` : null,
		fetcher,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: true,
			shouldRetryOnError: false,
			dedupingInterval: 30000,
			keepPreviousData: true,
		},
	);

	// ユーザーの投稿を取得（ページネーション対応）
	const POSTS_PER_PAGE = 50;
	const {
		data: postsData,
		error: postsError,
		isLoading: postsLoading,
		mutate: mutatePosts,
	} = useSWR<{ posts: PostWithUser[] }>(
		accountId ? `/api/users/account/${accountId}/posts?limit=${POSTS_PER_PAGE}&offset=${postsPage * POSTS_PER_PAGE}` : null,
		authFetcher,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: true,
			shouldRetryOnError: false,
			dedupingInterval: 30000,
			keepPreviousData: false, // 無限スクロールでは前のデータを保持しない
		},
	);

	// 投稿データが更新されたら、allPostsに追加
	useEffect(() => {
		if (postsData?.posts) {
			if (process.env.NODE_ENV === "development") {
				console.log("投稿データ更新:", {
					page: postsPage,
					receivedCount: postsData.posts.length,
					hasMorePosts: postsData.posts.length === POSTS_PER_PAGE,
				});
			}
			if (postsPage === 0) {
				// 最初のページの場合は置き換え
				setAllPosts(postsData.posts);
			} else {
				// 2ページ目以降は追加
				setAllPosts((prev) => {
					const newPosts = [...prev, ...postsData.posts];
					if (process.env.NODE_ENV === "development") {
						console.log("投稿追加後:", { totalCount: newPosts.length });
					}
					return newPosts;
				});
			}
			// 取得した投稿数がPOSTS_PER_PAGE未満なら、これ以上取得する必要がない
			setHasMorePosts(postsData.posts.length === POSTS_PER_PAGE);
			setIsLoadingMorePosts(false);
		} else if (postsData === null && !postsLoading && postsPage > 0) {
			// データがnullで、ロード中でなく、2ページ目以降の場合
			setHasMorePosts(false);
			setIsLoadingMorePosts(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [postsData, postsPage, postsLoading]);

	// accountIdが変更されたら、投稿リストをリセット
	useEffect(() => {
		setPostsPage(0);
		setAllPosts([]);
		setHasMorePosts(true);
	}, [accountId]);

	// 次のページの投稿を取得
	const loadMorePosts = useCallback(() => {
		if (isLoadingMorePosts || !hasMorePosts || postsLoading) {
			if (process.env.NODE_ENV === "development") {
				console.log("loadMorePosts スキップ:", {
					isLoadingMorePosts,
					hasMorePosts,
					postsLoading,
				});
			}
			return;
		}
		if (process.env.NODE_ENV === "development") {
			console.log("loadMorePosts 実行: 次のページを読み込み", postsPage + 1);
		}
		setIsLoadingMorePosts(true);
		setPostsPage((prev) => prev + 1);
	}, [isLoadingMorePosts, hasMorePosts, postsLoading, postsPage]);

	// Intersection Observerでスクロール位置を監視
	const isHandlingRef = useRef(false); // 重複実行を防ぐフラグ

	useEffect(() => {
		// 投稿が表示されていない、または読み込み中、またはもう読み込むものがない場合はObserverを設定しない
		if (allPosts.length === 0 || isLoadingMorePosts || postsLoading || !hasMorePosts) {
			if (process.env.NODE_ENV === "development") {
				console.log("Observer 設定スキップ:", {
					hasMorePosts,
					isLoadingMorePosts,
					postsLoading,
					allPostsLength: allPosts.length,
				});
			}
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && !isHandlingRef.current) {
					isHandlingRef.current = true;
					if (process.env.NODE_ENV === "development") {
						console.log("Intersection Observer トリガー: 次のページを読み込み");
					}
					// loadMorePosts関数を使用
					loadMorePosts();
					// 少し遅延してフラグをリセット（次の読み込みを許可）
					setTimeout(() => {
						isHandlingRef.current = false;
					}, 1000);
				}
			},
			{ threshold: 0.1, rootMargin: "200px" }, // 200px手前でトリガー
		);

		const currentTarget = postsObserverTarget.current;
		if (currentTarget) {
			if (process.env.NODE_ENV === "development") {
				console.log("Observer 設定完了:", {
					hasMorePosts,
					allPostsLength: allPosts.length,
					targetExists: !!currentTarget,
				});
			}
			observer.observe(currentTarget);
		} else {
			if (process.env.NODE_ENV === "development") {
				console.warn("Observer target が見つかりません");
			}
		}

		return () => {
			if (currentTarget) {
				observer.unobserve(currentTarget);
			}
		};
	}, [hasMorePosts, isLoadingMorePosts, postsLoading, allPosts.length, loadMorePosts]);

	// フィードを取得（自分自身のプロフィールの場合のみ）
	const {
		data: feedData,
		error: feedError,
		isLoading: feedLoading,
		mutate: mutateFeed,
	} = useSWR<{ posts: PostWithUser[] }>(
		isOwnProfile ? `/api/users/me/feed` : null,
		authFetcher,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: true,
			shouldRetryOnError: false,
			dedupingInterval: 30000,
			keepPreviousData: true,
		},
	);

	// フォロー中のユーザーを取得
	const {
		data: followingData,
		error: followingError,
		isLoading: followingLoading,
		mutate: mutateFollowing,
	} = useSWR<{ users: User[] }>(
		accountId ? `/api/users/account/${accountId}/follows?type=following` : null,
		fetcher,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: true,
			shouldRetryOnError: false,
			dedupingInterval: 30000,
			keepPreviousData: true,
		},
	);

	// フォロワーを取得
	const {
		data: followersData,
		error: followersError,
		isLoading: followersLoading,
		mutate: mutateFollowers,
	} = useSWR<{ users: User[] }>(
		accountId ? `/api/users/account/${accountId}/follows?type=followers` : null,
		fetcher,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: true,
			shouldRetryOnError: false,
			dedupingInterval: 30000,
			keepPreviousData: true,
		},
	);

	// いいねした投稿を取得
	const {
		data: likedPostsData,
		error: likedPostsError,
		isLoading: likedPostsLoading,
		mutate: mutateLikedPosts,
	} = useSWR<{ posts: PostWithUser[] }>(
		accountId ? `/api/users/account/${accountId}/likes` : null,
		authFetcher,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: true,
			shouldRetryOnError: false,
			dedupingInterval: 30000,
			keepPreviousData: true,
		},
	);

	// コメントを取得
	const {
		data: commentsData,
		error: commentsError,
		isLoading: commentsLoading,
		mutate: mutateComments,
	} = useSWR<{ comments: any[] }>(
		accountId ? `/api/users/account/${accountId}/comments` : null,
		authFetcher,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: true,
			shouldRetryOnError: false,
			dedupingInterval: 30000,
			keepPreviousData: true,
		},
	);

	// ネットワークエラー時の再試行ボタン
	const handleRetry = () => {
		mutateUser();
		// 投稿をリセットして最初から再取得
		setPostsPage(0);
		setAllPosts([]);
		mutatePosts();
		if (isOwnProfile) {
			mutateFeed();
		}
		mutateFollowing();
		mutateFollowers();
		mutateLikedPosts();
		mutateComments();
	};

	// いいね状態変更のハンドラー
	const handleLikeChange = (
		postId: string,
		likeCount: number,
		isLiked: boolean,
	) => {
		// allPostsを更新
		setAllPosts((prev) =>
			prev.map((post) =>
				post.id === postId ? { ...post, likeCount, isLiked } : post,
			),
		);

		// 投稿データを更新
		mutatePosts((currentData) => {
			if (!currentData) return currentData;
			return {
				...currentData,
				posts: currentData.posts.map((post) =>
					post.id === postId ? { ...post, likeCount, isLiked } : post,
				),
			};
		}, false);

		// フィードデータも更新（自分自身のプロフィールの場合）
		if (isOwnProfile) {
			mutateFeed((currentData) => {
				if (!currentData) return currentData;
				return {
					...currentData,
					posts: currentData.posts.map((post) =>
						post.id === postId ? { ...post, likeCount, isLiked } : post,
					),
				};
			}, false);
		}

		// いいね投稿データも更新
		mutateLikedPosts((currentData) => {
			if (!currentData) return currentData;
			return {
				...currentData,
				posts: currentData.posts.map((post) =>
					post.id === postId ? { ...post, likeCount, isLiked } : post,
				),
			};
		}, false);
	};

	// 投稿更新のハンドラー
	const handlePostUpdate = (postId: string) => {
		// 投稿データを再取得（最初のページから再取得）
		setPostsPage(0);
		setAllPosts([]);
		mutatePosts();
		if (isOwnProfile) {
			mutateFeed();
		}
		mutateLikedPosts();
	};

	// 投稿削除のハンドラー
	const handlePostDelete = (postId: string) => {
		// allPostsから削除
		setAllPosts((prev) => prev.filter((post) => post.id !== postId));

		// 投稿データから削除
		mutatePosts((currentData) => {
			if (!currentData) return currentData;
			return {
				...currentData,
				posts: currentData.posts.filter((post) => post.id !== postId),
			};
		}, false);

		// フィードデータからも削除（自分自身のプロフィールの場合）
		if (isOwnProfile) {
			mutateFeed((currentData) => {
				if (!currentData) return currentData;
				return {
					...currentData,
					posts: currentData.posts.filter((post) => post.id !== postId),
				};
			}, false);
		}

		// いいね投稿データからも削除
		mutateLikedPosts((currentData) => {
			if (!currentData) return currentData;
			return {
				...currentData,
				posts: currentData.posts.filter((post) => post.id !== postId),
			};
		}, false);
	};

	// コメント更新のハンドラー
	const handleCommentUpdate = (commentId: string) => {
		// コメントデータを再取得
		mutateComments();
	};

	// コメント削除のハンドラー
	const handleCommentDelete = (commentId: string) => {
		// コメントデータから削除
		mutateComments((currentData) => {
			if (!currentData) return currentData;
			return {
				...currentData,
				comments: currentData.comments.filter(
					(comment) => comment.id !== commentId,
				),
			};
		}, false);
	};

	// コメントいいね状態変更のハンドラー
	const handleCommentLikeChange = (
		commentId: string,
		likeCount: number,
		isLiked: boolean,
	) => {
		// コメントデータを更新
		mutateComments((currentData) => {
			if (!currentData) return currentData;
			return {
				...currentData,
				comments: currentData.comments.map((comment) =>
					comment.id === commentId
						? { ...comment, likeCount, isLiked }
						: comment,
				),
			};
		}, false);
	};

	if (!accountId || userLoading) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="animate-pulse">
					<div className="w-full h-48 bg-gray-200 rounded-lg mb-6"></div>
					<div className="space-y-4">
						<div className="h-8 bg-gray-200 rounded w-1/3"></div>
						<div className="h-4 bg-gray-200 rounded w-1/4"></div>
					</div>
				</div>
			</div>
		);
	}

	// エラーが発生したが、既存のデータがある場合は表示を継続
	if (userError && !userData?.user) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-red-600 mb-4">
						エラーが発生しました
					</h1>
					<p className="text-gray-600 mb-4">ユーザー情報の取得に失敗しました</p>
					<button
						onClick={handleRetry}
						className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
					>
						再試行
					</button>
				</div>
			</div>
		);
	}

	// ユーザーデータがない場合
	if (!userData?.user) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-gray-600 mb-4">
						ユーザーが見つかりません
					</h1>
					<p className="text-gray-500">
						指定されたアカウントIDのユーザーは存在しません
					</p>
				</div>
			</div>
		);
	}

	const user = userData.user;
	const posts = allPosts; // 無限スクロール用の累積投稿リストを使用
	const feedPosts = feedData?.posts || [];
	const followingUsers = followingData?.users || [];
	const followersUsers = followersData?.users || [];
	const likedPosts = likedPostsData?.posts || [];
	const comments = commentsData?.comments || [];

	return (
		<div className="container mx-auto px-4 py-8">
			{/* ネットワークエラー時の警告バナー */}
			{userError && (
				<div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-yellow-800 text-sm">
								サーバーとの接続が不安定です。表示されている内容は最新ではない可能性があります。
							</p>
						</div>
						<button
							onClick={handleRetry}
							className="ml-4 px-3 py-1 bg-yellow-500 text-white text-sm rounded hover:bg-yellow-600 transition-colors"
						>
							更新
						</button>
					</div>
				</div>
			)}

			{/* プロフィールヘッダー */}
			<ProfileHeader user={user} />

			{/* タブコンテンツ */}
			<Tabs defaultValue={isOwnProfile ? "feed" : "posts"} className="w-full">
				<TabsList
					className="grid w-full"
					style={{
						gridTemplateColumns: isOwnProfile
							? "repeat(6, 1fr)"
							: "repeat(5, 1fr)",
					}}
				>
					{isOwnProfile && <TabsTrigger value="feed">フィード</TabsTrigger>}
					<TabsTrigger value="posts">投稿</TabsTrigger>
					<TabsTrigger value="following">フォロー中</TabsTrigger>
					<TabsTrigger value="followers">フォロワー</TabsTrigger>
					<TabsTrigger value="likes">いいね</TabsTrigger>
					<TabsTrigger value="comments">コメント</TabsTrigger>
				</TabsList>

				{/* フィードタブ（自分自身のプロフィールのみ） */}
				{isOwnProfile && (
					<TabsContent value="feed" className="mt-6">
						{feedLoading ? (
							<div className="space-y-4">
								{Array.from({ length: 3 }).map((_, i) => (
									<div key={i} className="animate-pulse">
										<div className="h-48 bg-gray-200 rounded-lg"></div>
									</div>
								))}
							</div>
						) : feedError ? (
							<div className="text-center py-8">
								<p className="text-gray-600 mb-4">
									フィードの取得に失敗しました
								</p>
								{feedPosts.length > 0 && (
									<p className="text-sm text-gray-500 mb-4">
										以前に取得した投稿を表示しています
									</p>
								)}
								<button
									onClick={handleRetry}
									className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
								>
									再試行
								</button>
							</div>
						) : feedPosts.length === 0 ? (
							<div className="text-center py-8">
								<p className="text-gray-600">フィードに投稿がありません</p>
							</div>
						) : (
							<PostCards
								posts={feedPosts}
								onLikeChange={handleLikeChange}
								onPostUpdate={handlePostUpdate}
								onPostDelete={handlePostDelete}
							/>
						)}
					</TabsContent>
				)}

				{/* 投稿タブ */}
				<TabsContent value="posts" className="mt-6">
					{postsLoading ? (
						<div className="space-y-4">
							{Array.from({ length: 3 }).map((_, i) => (
								<div key={i} className="animate-pulse">
									<div className="h-48 bg-gray-200 rounded-lg"></div>
								</div>
							))}
						</div>
					) : postsError ? (
						<div className="text-center py-8">
							<p className="text-gray-600 mb-4">投稿の取得に失敗しました</p>
							{posts.length > 0 && (
								<p className="text-sm text-gray-500 mb-4">
									以前に取得した投稿を表示しています
								</p>
							)}
							<button
								onClick={handleRetry}
								className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
							>
								再試行
							</button>
						</div>
					) : posts.length === 0 ? (
						<div className="text-center py-8">
							<p className="text-gray-600">まだ投稿がありません</p>
						</div>
					) : (
						<>
							<PostCards
								posts={posts}
								onLikeChange={handleLikeChange}
								onPostUpdate={handlePostUpdate}
								onPostDelete={handlePostDelete}
							/>
							{/* 無限スクロール用の監視要素 */}
							{hasMorePosts && (
								<div 
									ref={postsObserverTarget} 
									className="h-20 flex items-center justify-center py-4"
									data-testid="infinite-scroll-trigger"
								>
									{isLoadingMorePosts && (
										<div className="animate-pulse text-gray-500">読み込み中...</div>
									)}
									{!isLoadingMorePosts && process.env.NODE_ENV === "development" && (
										<div className="text-xs text-gray-400">
											スクロールして続きを読み込む ({posts.length}件表示中)
										</div>
									)}
								</div>
							)}
							{!hasMorePosts && posts.length > 0 && (
								<div className="text-center py-4 text-gray-500">
									すべての投稿を表示しました
								</div>
							)}
						</>
					)}
				</TabsContent>

				{/* フォロー中タブ */}
				<TabsContent value="following" className="mt-6">
					{followingLoading ? (
						<div className="space-y-4">
							{Array.from({ length: 3 }).map((_, i) => (
								<div key={i} className="animate-pulse">
									<div className="h-24 bg-gray-200 rounded-lg"></div>
								</div>
							))}
						</div>
					) : followingError ? (
						<div className="text-center py-8">
							<p className="text-gray-600 mb-4">
								フォロー中のユーザー取得に失敗しました
							</p>
							<button
								onClick={handleRetry}
								className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
							>
								再試行
							</button>
						</div>
					) : (
						<UserCards users={followingUsers} type="following" />
					)}
				</TabsContent>

				{/* フォロワータブ */}
				<TabsContent value="followers" className="mt-6">
					{followersLoading ? (
						<div className="space-y-4">
							{Array.from({ length: 3 }).map((_, i) => (
								<div key={i} className="animate-pulse">
									<div className="h-24 bg-gray-200 rounded-lg"></div>
								</div>
							))}
						</div>
					) : followersError ? (
						<div className="text-center py-8">
							<p className="text-gray-600 mb-4">フォロワー取得に失敗しました</p>
							<button
								onClick={handleRetry}
								className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
							>
								再試行
							</button>
						</div>
					) : (
						<UserCards users={followersUsers} type="followers" />
					)}
				</TabsContent>

				{/* いいねタブ */}
				<TabsContent value="likes" className="mt-6">
					{likedPostsLoading ? (
						<div className="space-y-4">
							{Array.from({ length: 3 }).map((_, i) => (
								<div key={i} className="animate-pulse">
									<div className="h-48 bg-gray-200 rounded-lg"></div>
								</div>
							))}
						</div>
					) : likedPostsError ? (
						<div className="text-center py-8">
							<p className="text-gray-600 mb-4">
								いいねした投稿の取得に失敗しました
							</p>
							<button
								onClick={handleRetry}
								className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
							>
								再試行
							</button>
						</div>
					) : likedPosts.length === 0 ? (
						<div className="text-center py-8">
							<p className="text-gray-600">いいねした投稿がありません</p>
						</div>
					) : (
						<PostCards
							posts={likedPosts}
							onLikeChange={handleLikeChange}
							onPostUpdate={handlePostUpdate}
							onPostDelete={handlePostDelete}
						/>
					)}
				</TabsContent>

				{/* コメントタブ */}
				<TabsContent value="comments" className="mt-6">
					{commentsLoading ? (
						<div className="space-y-4">
							{Array.from({ length: 3 }).map((_, i) => (
								<div key={i} className="animate-pulse">
									<div className="h-48 bg-gray-200 rounded-lg"></div>
								</div>
							))}
						</div>
					) : commentsError ? (
						<div className="text-center py-8">
							<p className="text-gray-600 mb-4">コメントの取得に失敗しました</p>
							<button
								onClick={handleRetry}
								className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
							>
								再試行
							</button>
						</div>
					) : comments.length === 0 ? (
						<div className="text-center py-8">
							<p className="text-gray-600">コメントがありません</p>
						</div>
					) : (
						<CommentCards
							comments={comments}
							onLikeChange={handleCommentLikeChange}
							onCommentUpdate={handleCommentUpdate}
							onCommentDelete={handleCommentDelete}
						/>
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}
