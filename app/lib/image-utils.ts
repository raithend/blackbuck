/**
 * 画像からEXIFデータを削除し、必要に応じてリサイズ・圧縮するユーティリティ関数
 * 
 * 注意: EXIFデータ自体は通常数KB〜数十KB程度と小さく、ファイルサイズ削減の主な目的ではありません。
 * この関数の主な目的は：
 * 1. プライバシー保護（撮影地情報の削除）
 * 2. ファイルサイズ削減（リサイズ・圧縮による）
 * 
 * Canvas APIを使用して画像を再描画することで、EXIFデータ（撮影地・撮影機材情報など）を削除し、
 * 同時にリサイズ・圧縮を行うことでファイルサイズを削減します。
 */

/**
 * 画像ファイルからEXIFデータを削除し、必要に応じてリサイズ・圧縮して新しいFileオブジェクトを返す
 * @param file 元の画像ファイル
 * @param maxSize 最大ファイルサイズ（バイト、デフォルト: 4MB）
 * @param maxDimension 最大画像サイズ（幅または高さの最大値、デフォルト: 1920px）
 * @returns EXIFデータが削除され、必要に応じてリサイズ・圧縮された新しいFileオブジェクト
 */
export async function removeExifData(
	file: File,
	maxSize: number = 4 * 1024 * 1024, // 4MB
	maxDimension: number = 1920, // 最大1920px
): Promise<File> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = (e) => {
			const img = new Image();
			img.onload = () => {
				try {
					// 元のファイル名と拡張子を保持
					const fileName = file.name;
					
					// MIMEタイプを決定（常にJPEGに変換してファイルサイズを削減）
					const mimeType = "image/jpeg";

					// リサイズと圧縮を繰り返してファイルサイズを制限内に収める
					const compressImage = (
						targetWidth: number,
						targetHeight: number,
						quality: number,
					): Promise<File> => {
						return new Promise((resolveCompress, rejectCompress) => {
							// Canvasを作成
							const tempCanvas = document.createElement("canvas");
							const tempCtx = tempCanvas.getContext("2d");
							if (!tempCtx) {
								rejectCompress(new Error("Canvas context not available"));
								return;
							}

							tempCanvas.width = targetWidth;
							tempCanvas.height = targetHeight;
							tempCtx.imageSmoothingEnabled = true;
							tempCtx.imageSmoothingQuality = "high";
							tempCtx.drawImage(img, 0, 0, targetWidth, targetHeight);

							tempCanvas.toBlob(
								(blob) => {
									if (!blob) {
										rejectCompress(new Error("Failed to create blob"));
										return;
									}

									// ファイルサイズが制限内の場合
									if (blob.size <= maxSize) {
										const newFile = new File(
											[blob],
											fileName,
											{
												type: mimeType,
												lastModified: Date.now(),
											},
										);
										resolveCompress(newFile);
									} else if (quality > 0.3) {
										// 品質を下げて再試行（最低0.3まで）
										compressImage(targetWidth, targetHeight, quality - 0.1)
											.then(resolveCompress)
											.catch(rejectCompress);
									} else if (targetWidth > 800 || targetHeight > 800) {
										// 品質が0.3以下でも4MBを超える場合、さらにリサイズ
										const aspectRatio = targetWidth / targetHeight;
										let newWidth = Math.min(targetWidth * 0.8, 800);
										let newHeight = newWidth / aspectRatio;
										if (newHeight > 800) {
											newHeight = 800;
											newWidth = 800 * aspectRatio;
										}
										compressImage(newWidth, newHeight, 0.7)
											.then(resolveCompress)
											.catch(rejectCompress);
									} else {
										// それでも4MBを超える場合は、現在のサイズで返す
										// （実際にはこのケースは稀）
										const newFile = new File(
											[blob],
											fileName,
											{
												type: mimeType,
												lastModified: Date.now(),
											},
										);
										resolveCompress(newFile);
									}
								},
								mimeType,
								quality,
							);
						});
					};

					// 画像のサイズを計算（アスペクト比を保持）
					let width = img.width;
					let height = img.height;

					// 最大サイズを超える場合はリサイズ
					if (width > maxDimension || height > maxDimension) {
						const aspectRatio = width / height;
						if (width > height) {
							width = maxDimension;
							height = maxDimension / aspectRatio;
						} else {
							height = maxDimension;
							width = maxDimension * aspectRatio;
						}
					}

					// 初期品質0.92から開始
					compressImage(width, height, 0.92).then(resolve).catch(reject);
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
 * @param maxSize 最大ファイルサイズ（バイト、デフォルト: 4MB）
 * @param maxDimension 最大画像サイズ（幅または高さの最大値、デフォルト: 1920px）
 * @returns EXIFデータが削除され、必要に応じてリサイズ・圧縮された新しいFileオブジェクトの配列
 */
export async function removeExifDataFromFiles(
	files: File[],
	maxSize: number = 4 * 1024 * 1024, // 4MB
	maxDimension: number = 1920, // 最大1920px
): Promise<File[]> {
	return Promise.all(files.map((file) => removeExifData(file, maxSize, maxDimension)));
}

