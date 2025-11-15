import { createClient } from "@/app/lib/supabase-server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ name: string }> },
) {
	try {
		const { name } = await params;
		const decodedName = decodeURIComponent(name);

		if (!decodedName) {
			return NextResponse.json(
				{ error: "Classification name is required" },
				{ status: 400 },
			);
		}

		const supabase = await createClient();

		// 分類が存在するかチェック（複数レコードの可能性を考慮）
		const { data: classifications, error: classificationError } = await supabase
			.from("classifications")
			.select("id")
			.eq("name", decodedName);

		if (classificationError && classificationError.code !== "PGRST116") {
			throw classificationError;
		}

		// 分類が存在しない場合は空のデータを返す
		if (!classifications || classifications.length === 0) {
			return NextResponse.json({
				habitatData: null,
				classification: null,
			});
		}

		// 複数のレコードが存在する場合、最初のレコードを使用
		const classification = classifications[0];
		if (classifications.length > 1) {
			console.warn(
				`複数のレコードが存在します: ${decodedName} (${classifications.length}件)。最初のレコードを使用します。`,
			);
		}

		// 生息地データを取得（ユーザー情報も含む）
		const { data: habitatData, error: habitatError } = await supabase
			.from("habitat_data")
			.select(`
				*,
				users!habitat_data_creator_fkey (
					id,
					account_id,
					username,
					avatar_url
				)
			`)
			.eq("classification_id", classification.id)
			.single();

		if (habitatError && habitatError.code !== "PGRST116") {
			throw habitatError;
		}

		return NextResponse.json({
			habitatData: habitatData || null,
			classification: classification,
		});
	} catch (error) {
		console.error("Habitat data API error:", error);
		return NextResponse.json(
			{ error: "Internal Server Error" },
			{ status: 500 },
		);
	}
}

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ name: string }> },
) {
	try {
		const { name } = await params;
		const decodedName = decodeURIComponent(name);
		const body = await request.json();

		if (!decodedName) {
			return NextResponse.json(
				{ error: "Classification name is required" },
				{ status: 400 },
			);
		}

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

		// 分類が存在するかチェック（複数レコードの可能性を考慮）
		const { data: classifications, error: classificationError } = await supabase
			.from("classifications")
			.select("id")
			.eq("name", decodedName);

		let classificationId: string;

		if (classificationError && classificationError.code !== "PGRST116") {
			throw classificationError;
		}

		if (!classifications || classifications.length === 0) {
			// 分類が存在しない場合は作成
			const { data: newClassification, error: createError } = await supabase
				.from("classifications")
				.insert({
					name: decodedName,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				})
				.select("id")
				.single();

			if (createError) {
				throw createError;
			}

			classificationId = newClassification.id;
		} else {
			// 複数のレコードが存在する場合、最初のレコードを使用
			// 重複レコードは後で削除する必要があるが、ここでは最初のレコードを使用
			if (classifications.length > 1) {
				console.warn(
					`複数のレコードが存在します: ${decodedName} (${classifications.length}件)。最初のレコードを使用します。`,
				);
			}
			classificationId = classifications[0].id;
		}

		// 既存の生息地データをチェック
		const { data: existingHabitat, error: habitatCheckError } = await supabase
			.from("habitat_data")
			.select("id")
			.eq("classification_id", classificationId)
			.single();

		let habitatData: unknown;
		let operationError: unknown;

		if (habitatCheckError && habitatCheckError.code === "PGRST116") {
			// 生息地データが存在しない場合は作成
			const { data: newHabitat, error: createHabitatError } = await supabase
				.from("habitat_data")
				.insert({
					classification_id: classificationId,
					content: body.content || "",
					creator: user.id,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				})
				.select()
				.single();

			habitatData = newHabitat;
			operationError = createHabitatError;
		} else if (habitatCheckError) {
			throw habitatCheckError;
		} else {
			// 生息地データが存在する場合は更新
			const { data: updatedHabitat, error: updateHabitatError } = await supabase
				.from("habitat_data")
				.update({
					content: body.content,
					creator: user.id,
					updated_at: new Date().toISOString(),
				})
				.eq("classification_id", classificationId)
				.select()
				.single();

			habitatData = updatedHabitat;
			operationError = updateHabitatError;
		}

		if (operationError) {
			console.error("Habitat data operation error:", operationError);
			return NextResponse.json(
				{ error: "Failed to save habitat data" },
				{ status: 500 },
			);
		}

		return NextResponse.json({ habitatData });
	} catch (error) {
		console.error("Habitat data API error:", error);
		return NextResponse.json(
			{ error: "Internal Server Error" },
			{ status: 500 },
		);
	}
}
