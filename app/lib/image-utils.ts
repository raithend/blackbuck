/**
 * 画像からEXIFデータを削除するユーティリティ関数
 * Canvas APIを使用して画像を再描画することで、EXIFデータ（撮影地・撮影機材情報など）を削除します
 */

/**
 * 画像ファイルからEXIFデータを削除し、新しいFileオブジェクトを返す
 * @param file 元の画像ファイル
 * @param quality JPEG品質（0.0-1.0、デフォルト: 0.92）
 * @returns EXIFデータが削除された新しいFileオブジェクト
 */
export async function removeExifData(
	file: File,
	quality: number = 0.92,
): Promise<File> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = (e) => {
			const img = new Image();
			img.onload = () => {
				try {
					// Canvasを作成
					const canvas = document.createElement("canvas");
					const ctx = canvas.getContext("2d");

					if (!ctx) {
						reject(new Error("Canvas context not available"));
						return;
					}

					// 画像のサイズを取得
					canvas.width = img.width;
					canvas.height = img.height;

					// 画像をCanvasに描画（これによりEXIFデータが削除される）
					ctx.drawImage(img, 0, 0);

					// CanvasからBlobを取得
					canvas.toBlob(
						(blob) => {
							if (!blob) {
								reject(new Error("Failed to create blob"));
								return;
							}

							// 元のファイル名と拡張子を保持
							const fileName = file.name;
							const fileExtension = fileName.split(".").pop()?.toLowerCase() || "jpg";
							
							// MIMEタイプを決定
							let mimeType = "image/jpeg";
							if (fileExtension === "png") {
								mimeType = "image/png";
							} else if (fileExtension === "gif") {
								mimeType = "image/gif";
							}

							// 新しいFileオブジェクトを作成
							const newFile = new File(
								[blob],
								fileName,
								{
									type: mimeType,
									lastModified: Date.now(),
								},
							);

							resolve(newFile);
						},
						file.type.startsWith("image/png") ? "image/png" : "image/jpeg",
						quality,
					);
				} catch (error) {
					reject(
						error instanceof Error
							? error
							: new Error("Failed to process image"),
					);
				}
			};

			img.onerror = () => {
				reject(new Error("Failed to load image"));
			};

			// 画像を読み込み
			if (e.target?.result) {
				img.src = e.target.result as string;
			} else {
				reject(new Error("Failed to read file"));
			}
		};

		reader.onerror = () => {
			reject(new Error("Failed to read file"));
		};

		// ファイルを読み込み
		reader.readAsDataURL(file);
	});
}

/**
 * 複数の画像ファイルからEXIFデータを削除
 * @param files 元の画像ファイルの配列
 * @param quality JPEG品質（0.0-1.0、デフォルト: 0.92）
 * @returns EXIFデータが削除された新しいFileオブジェクトの配列
 */
export async function removeExifDataFromFiles(
	files: File[],
	quality: number = 0.92,
): Promise<File[]> {
	return Promise.all(files.map((file) => removeExifData(file, quality)));
}

