"use client";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/utils";
import { ImagePlus, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useState, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";

interface ImageUploadProps {
	value: File[];
	onChange: (value: File[]) => void;
}

export function ImageUpload({ value, onChange }: ImageUploadProps) {
	const [previewUrls, setPreviewUrls] = useState<string[]>([]);
    // Track blob URLs created via URL.createObjectURL so we can revoke them
    const objectUrlsRef = useRef<Set<string>>(new Set());
	
	// valueが空になった場合（リセット時）にプレビューURLもクリア
    useEffect(() => {
        if (value.length === 0) {
            // Revoke any remaining object URLs on reset
            for (const u of objectUrlsRef.current) {
                try { URL.revokeObjectURL(u); } catch {}
            }
            objectUrlsRef.current.clear();
            setPreviewUrls([]);
        }
    }, [value]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            for (const u of objectUrlsRef.current) {
                try { URL.revokeObjectURL(u); } catch {}
            }
            objectUrlsRef.current.clear();
        };
    }, []);
	
	// Chrome特有の問題を検出
	const isChrome = typeof window !== 'undefined' && 
		window.navigator.userAgent.includes('Chrome') && 
		!window.navigator.userAgent.includes('Edge') && 
		!window.navigator.userAgent.includes('Brave');

	const onDrop = useCallback(
		(acceptedFiles: File[]) => {
			try {
				// ChromeでのSTATUS_ILLEGAL_INSTRUCTIONエラーを回避するため、
				// エラーハンドリングを追加
				const processFiles = async () => {
					const newPreviewUrls: string[] = [];
					
                    for (const file of acceptedFiles) {
						try {
							// Chromeでの問題を回避するため、少し遅延を入れる
							if (isChrome) {
								await new Promise(resolve => setTimeout(resolve, 50));
							}
							
							// まずURL.createObjectURLを試す
                            const url = URL.createObjectURL(file);
                            newPreviewUrls.push(url);
                            objectUrlsRef.current.add(url);
						} catch (error) {
							console.error("URL.createObjectURL error:", error);
							
							// エラーが発生した場合は、FileReaderを使用
							try {
								const reader = new FileReader();
								const url = await new Promise<string>((resolve, reject) => {
									reader.onload = () => resolve(reader.result as string);
									reader.onerror = () => reject(reader.error);
									reader.readAsDataURL(file);
								});
								newPreviewUrls.push(url);
							} catch (fileReaderError) {
								console.error("FileReader error:", fileReaderError);
								// 両方の方法が失敗した場合は、ファイルをスキップ
							}
						}
					}

					setPreviewUrls((prev) => [...prev, ...newPreviewUrls]);
					// 親コンポーネントにファイルを渡す
					onChange([...value, ...acceptedFiles]);
				};

				processFiles();
			} catch (error) {
				console.error("Image upload error:", error);
				// エラーが発生した場合の処理
				alert("画像の読み込み中にエラーが発生しました。別の画像を試してください。");
			}
		},
		[value, onChange, isChrome],
	);

	const { getRootProps, getInputProps } = useDropzone({
		accept: {
			"image/*": [".jpeg", ".jpg", ".png", ".gif"],
		},
		onDrop,
		maxSize: 4 * 1024 * 1024, // 4MB - Vercelの4.5MB制限に対応
	});

	const handleRemove = (index: number) => {
        // プレビューURLの削除 + blob URLの解放
        const targetUrl = previewUrls[index];
        if (targetUrl && objectUrlsRef.current.has(targetUrl)) {
            try { URL.revokeObjectURL(targetUrl); } catch {}
            objectUrlsRef.current.delete(targetUrl);
        }
        const newPreviewUrls = previewUrls.filter((_, i) => i !== index);
        setPreviewUrls(newPreviewUrls);

		// 親コンポーネントに更新されたファイルリストを渡す
		const newFiles = value.filter((_, i) => i !== index);
		onChange(newFiles);
	};

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-4">
				{previewUrls.map((url, index) => (
					<div key={url} className="relative aspect-square">
						<Image
							src={url}
							alt={`アップロード画像 ${index + 1}`}
							width={300}
							height={300}
							className="w-full h-full object-cover rounded-lg"
						/>
						<Button
							variant="destructive"
							size="icon"
							className="absolute top-2 right-2"
							onClick={() => handleRemove(index)}
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				))}
			</div>
			<div className="grid gap-2">
				<div
					{...getRootProps()}
					className="border-2 border-dashed p-4 rounded-lg"
				>
					<input {...getInputProps()} />
					<p>画像をドラッグ＆ドロップ、またはクリックして選択</p>
				</div>
			</div>
		</div>
	);
}
