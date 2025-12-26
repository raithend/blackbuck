import { createClient } from "@/app/lib/supabase-server";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

if (
	!process.env.AWS_ACCESS_KEY_ID ||
	!process.env.AWS_SECRET_ACCESS_KEY ||
	!process.env.AWS_S3_BUCKET
) {
	throw new Error("環境変数が設定されていません");
}

const s3Client = new S3Client({
	region: process.env.AWS_REGION,
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	},
});

export async function POST(request: NextRequest) {
	try {
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

		const formData = await request.formData();
		const file = formData.get("file") as File;
		if (!file) {
			return NextResponse.json(
				{ error: "ファイルが見つかりません" },
				{ status: 400 },
			);
		}

		// ファイルサイズチェック（4MB以下 - Vercelの4.5MB制限に対応）
		// Vercelのサーバーレス関数のリクエストボディサイズ制限は4.5MBのため、4MB以下に制限
		const maxSize = 4 * 1024 * 1024; // 4MB
		if (file.size > maxSize) {
			return NextResponse.json(
				{ 
					error: `ファイルサイズが大きすぎます。最大4MBまで対応しています。現在のファイルサイズ: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
					fileSize: file.size,
					maxSize: maxSize,
				},
				{ status: 400 },
			);
		}

		// ファイル形式チェック
		const allowedTypes = [
			"image/jpeg",
			"image/jpg",
			"image/png",
			"image/gif",
		];
		if (!allowedTypes.includes(file.type)) {
			return NextResponse.json(
				{ error: "対応していないファイル形式です" },
				{ status: 400 },
			);
		}



		// 投稿画像専用のディレクトリに保存
		const key = `posts/${Date.now()}-${file.name}`;
		const command = new PutObjectCommand({
			Bucket: process.env.AWS_S3_BUCKET!,
			Key: key,
			ContentType: file.type,
		});

		let signedUrl: string;
		try {
			signedUrl = await getSignedUrl(s3Client, command, {
				expiresIn: 3600,
			});
		} catch (error) {
			throw new Error(`署名付きURLの生成に失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}`);
		}

		const uploadResponse = await fetch(signedUrl, {
			method: "PUT",
			body: file,
			headers: {
				"Content-Type": file.type,
			},
		});

		if (!uploadResponse.ok) {
			const errorText = await uploadResponse.text();
			throw new Error(`S3へのアップロードに失敗しました: ${uploadResponse.status} - ${errorText}`);
		}

		const url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
		return NextResponse.json({ url });
	} catch (error) {
		return NextResponse.json(
			{ error: `投稿画像のアップロードに失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}` },
			{ status: 500 },
		);
	}
}
