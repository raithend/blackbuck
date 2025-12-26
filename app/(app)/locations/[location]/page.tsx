"use client";

import { LocationEditButton } from "@/app/components/location/location-edit-button";
import { PostCards } from "@/app/components/post/post-cards";
import type { Location, PostWithUser } from "@/app/types/types";
import { Info, MapPin } from "lucide-react";
import Image from "next/image";
import { useParams } from "next/navigation";
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

export default function LocationPage() {
	const params = useParams();
	const rawLocation = params.location as string;

	// locationパラメータをデコード（既にエンコードされている場合があるため）
	const location = decodeURIComponent(rawLocation);

	// 無限スクロール用の状態
	const [postsPage, setPostsPage] = useState(0);
	const [allPosts, setAllPosts] = useState<PostWithUser[]>([]);
	const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
	const [hasMorePosts, setHasMorePosts] = useState(true);
	const postsObserverTarget = useRef<HTMLDivElement>(null);

	// locationの詳細情報を取得
	const {
		data: locationData,
		error: locationError,
		isLoading: locationLoading,
	} = useSWR<{ location: Location | null }>(
		location ? `/api/locations/${encodeURIComponent(location)}` : null,
		fetcher,
	);

	// locationの投稿を取得（ページネーション対応）
	const POSTS_PER_PAGE = 20;
	const {
		data: postsData,
		error: postsError,
		isLoading: postsLoading,
		mutate: mutatePosts,
	} = useSWR<{ posts: PostWithUser[] }>(
		location ? `/api/posts?location=${encodeURIComponent(location)}&limit=${POSTS_PER_PAGE}&offset=${postsPage * POSTS_PER_PAGE}` : null,
		fetcher,
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

	// locationが変更されたら、投稿リストをリセット
	useEffect(() => {
		setPostsPage(0);
		setAllPosts([]);
		setHasMorePosts(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rawLocation]); // rawLocationが変更されたらリセット

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
					postsPage,
					allPostsLength: allPosts.length,
				});
			}
			return;
		}

		// 最後の10件が表示されたら読み込むように、rootMarginを大きく設定
		// 1件の投稿カードの高さを約400pxと仮定し、10件分 = 約4000px手前でトリガー
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
			{ threshold: 0.1, rootMargin: "4000px" }, // 最後の10件が表示されたらトリガー（裏で読み込み）
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
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [hasMorePosts, isLoadingMorePosts, postsLoading, allPosts.length, loadMorePosts]);

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
	};

	// 投稿更新のハンドラー
	const handlePostUpdate = (postId: string) => {
		// 投稿データを再取得（最初のページから再取得）
		setPostsPage(0);
		setAllPosts([]);
		mutatePosts();
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
	};

	if (locationLoading) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="text-center">
					<div className="text-2xl font-bold mb-4">
						{location}の情報を読み込み中...
					</div>
				</div>
			</div>
		);
	}

	if (locationError) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="text-center">
					<div className="text-2xl font-bold mb-4 text-red-600">
						エラーが発生しました
					</div>
					<div className="text-gray-600">
						場所情報の取得に失敗しました。しばらく時間をおいてから再度お試しください。
					</div>
				</div>
			</div>
		);
	}

	const locationInfo: Location | null = locationData?.location || null;
	const posts = allPosts; // 無限スクロール用の累積投稿リストを使用

	return (
		<div className="container mx-auto px-4 py-8">
			{/* Location Header */}
			<div className="mb-8">
				{/* Header Image */}
				{locationInfo?.header_url && (
					<div className="relative w-full h-48 mb-6 rounded-lg overflow-hidden">
						<Image
							src={locationInfo.header_url}
							alt={`${location}のヘッダー画像`}
							width={1200}
							height={400}
							className="w-full h-full object-cover"
						/>
					</div>
				)}

				{/* Location Info */}
				<div className="flex items-start gap-4">
					<div className="flex-1">
						<div className="flex items-center justify-between mb-2">
							<div className="flex items-center gap-2">
								<MapPin className="w-5 h-5 text-gray-500" />
								<h1 className="text-3xl font-bold">{location}</h1>
							</div>
							{locationInfo && <LocationEditButton location={locationInfo} />}
						</div>

						{locationInfo?.description ? (
							<p className="text-gray-600 text-lg mb-4">
								{locationInfo.description}
							</p>
						) : (
							<div className="flex items-center gap-2 text-gray-500 mb-4">
								<Info className="w-5 h-5" />
								<span>場所の情報が設定されていません</span>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Posts Section */}
			<div className="mb-6">
				<h2 className="text-2xl font-bold mb-4">投稿一覧</h2>
				{/* 最初のロード時のみスケルトンを表示 */}
				{postsLoading && postsPage === 0 && allPosts.length === 0 ? (
					<div className="text-center py-8">
						<div className="text-lg mb-2">投稿を読み込み中...</div>
					</div>
				) : postsError ? (
					<div className="text-center py-8">
						<div className="text-lg text-red-600 mb-2">
							投稿の取得に失敗しました
						</div>
					</div>
				) : posts.length === 0 ? (
					<div className="text-center py-12">
						<div className="text-xl font-semibold mb-2 text-gray-600">
							{location}の投稿はまだありません
						</div>
						<p className="text-gray-500">
							この場所で最初の投稿をしてみませんか？
						</p>
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
								aria-hidden="true"
							/>
						)}
						{!hasMorePosts && posts.length > 0 && (
							<div className="text-center py-4 text-gray-500">
								すべての投稿を表示しました
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
