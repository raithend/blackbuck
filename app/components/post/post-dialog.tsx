"use client";

import { EventDialog } from "@/app/components/event/event-dialog";
import { LocationDialog } from "@/app/components/location/location-dialog";
import { ImageUpload } from "@/app/components/post/image-upload";
import { Button } from "@/app/components/ui/button";
import {
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { useUser } from "@/app/contexts/user-context";
import { removeExifData } from "@/app/lib/image-utils";
import { useState } from "react";

interface PostDialogProps {
	onPost: (data: {
		content?: string;
		location?: string;
		event?: string;
		classification?: string;
		imageUrls: string[];
	}) => Promise<void>;
}

export function PostDialog({ onPost }: PostDialogProps) {
	const [content, setContent] = useState("");
	const [location, setLocation] = useState("");
	const [event, setEvent] = useState("");
	const [classification, setClassification] = useState("");
	const [imageFiles, setImageFiles] = useState<File[]>([]);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [resetKey, setResetKey] = useState(0); // リセット用のキー
	const { session } = useUser();

	const uploadToS3 = async (file: File): Promise<string> => {
		// EXIFデータ（撮影地・撮影機材情報）を削除
		// これによりファイルサイズも削減されます
		let processedFile: File;
		try {
			processedFile = await removeExifData(file, 0.92);
		} catch (error) {
			console.warn("EXIFデータの削除に失敗しました。元のファイルを使用します:", error);
			processedFile = file;
		}

		// ファイルサイズチェック（4MB以下 - Vercelの4.5MB制限に対応）
		const maxSize = 4 * 1024 * 1024; // 4MB
		if (processedFile.size > maxSize) {
			throw new Error(
				`ファイルサイズが大きすぎます。最大4MBまで対応しています。現在のファイルサイズ: ${(processedFile.size / 1024 / 1024).toFixed(2)}MB`,
			);
		}

		const formData = new FormData();
		formData.append("file", processedFile);

		// 認証トークンを取得
		const supabase = await import("@/app/lib/supabase-browser").then((m) =>
			m.createClient(),
		);
		const {
			data: { session },
		} = await supabase.auth.getSession();

		console.log("Session:", session); // デバッグ用

		if (!session?.access_token) {
			throw new Error("認証トークンが取得できません");
		}

		const response = await fetch("/api/upload/posts", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${session.access_token}`,
			},
			body: formData,
		});

		if (!response.ok) {
			// 413エラーの場合、特別なメッセージを表示
			if (response.status === 413) {
				throw new Error(
					`ファイルサイズが大きすぎます。Vercelの制限により、4MB以下のファイルのみアップロードできます。現在のファイルサイズ: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
				);
			}

			const errorData = await response
				.json()
				.catch(() => ({ error: "不明なエラー" }));
			throw new Error(
				errorData.error || `アップロードに失敗しました (${response.status})`,
			);
		}

		const data = await response.json();
		return data.url;
	};

	const handleSubmit = async () => {
		try {
			setIsSubmitting(true);

			// S3に画像をアップロード
			const imageUrls = await Promise.all(
				imageFiles.map((file) => uploadToS3(file)),
			);

			// 投稿データを送信
			await onPost({
				content,
				location,
				event,
				classification,
				imageUrls,
			});

			// 投稿成功後にフォームをリセット
			setContent("");
			setLocation("");
			setEvent("");
			setClassification("");
			setImageFiles([]);
			setResetKey((prev) => prev + 1); // リセットキーを更新
		} catch (error) {
			// エラー処理
			console.error("投稿エラー:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>新規投稿</DialogTitle>
			</DialogHeader>
			<div className="space-y-4">
				<Textarea
					placeholder="投稿内容を入力してください"
					value={content}
					onChange={(e) => setContent(e.target.value)}
				/>
				<LocationDialog value={location} onChange={setLocation} />
				<EventDialog value={event} onChange={setEvent} />
				<Input
					type="text"
					placeholder="分類"
					value={classification}
					onChange={(e) => setClassification(e.target.value)}
				/>
				<ImageUpload
					value={imageFiles}
					onChange={setImageFiles}
					key={resetKey}
				/>
				<Button
					onClick={handleSubmit}
					disabled={
						isSubmitting ||
						((!content || content.trim() === "") && imageFiles.length === 0)
					}
					className="w-full"
				>
					{isSubmitting ? "投稿中..." : "投稿する"}
				</Button>
			</div>
		</DialogContent>
	);
}
