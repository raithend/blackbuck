"use client";

import { AuthDialog } from "@/app/components/auth/auth-dialog";
import { GeologicalAgeCard } from "@/app/components/geological/geological-age-card";
import { GeologicalAgeProvider } from "@/app/components/geological/geological-context";
import PhylogeneticTreeArea from "@/app/components/phylogenetic/phylogenetic-tree-area";
import { Button } from "@/app/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import { createClient } from "@/app/lib/supabase-browser";
import { useUser } from "@/app/contexts/user-context";
import { ArrowLeft, Download, Save, Sparkles, Upload } from "lucide-react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Monaco Editorを動的インポート（SSRを避けるため）
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
	ssr: false,
});

export default function PhylogeneticTreeEditPage() {
	const params = useParams();
	const router = useRouter();
	const decodedName = decodeURIComponent(params.name as string);
	const { user } = useUser();
	const [treeContent, setTreeContent] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isGenerating, setIsGenerating] = useState(false);
	const [originalContent, setOriginalContent] = useState("");
	const [yamlError, setYamlError] = useState<string | null>(null);
	const [authDialogOpen, setAuthDialogOpen] = useState(false);

	// 自動保存用のタイマーとフラグ
	const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
	const [isAutoSaving, setIsAutoSaving] = useState(false);
	const [lastAutoSaveTime, setLastAutoSaveTime] = useState<Date | null>(null);

	// 既存の系統樹データを取得
	useEffect(() => {
		const fetchTreeData = async () => {
			setIsLoading(true);
			try {
				const response = await fetch(
					`/api/classifications/${encodeURIComponent(decodedName)}/phylogenetic-trees`,
				);
				if (response.ok) {
					const data = await response.json();
					const content = data.phylogeneticTree?.content || "";
					setTreeContent(content);
					setOriginalContent(content);
				}
			} catch (error) {
				console.error("系統樹データの取得に失敗しました:", error);
				toast.error("系統樹データの取得に失敗しました");
			} finally {
				setIsLoading(false);
			}
		};

		fetchTreeData();
	}, [decodedName]);

	// 自動保存処理
	const handleAutoSave = async () => {
		if (treeContent === originalContent) {
			return; // 変更がない場合は保存しない
		}

		setIsAutoSaving(true);
		try {
			const supabase = createClient();
			const {
				data: { session },
			} = await supabase.auth.getSession();

			const response = await fetch(
				`/api/classifications/${encodeURIComponent(decodedName)}/phylogenetic-trees`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${session?.access_token}`,
					},
					body: JSON.stringify({
						content: treeContent,
					}),
				},
			);

			if (!response.ok) {
				throw new Error("自動保存に失敗しました");
			}

			setOriginalContent(treeContent);
			setLastAutoSaveTime(new Date());
			toast.success("自動保存しました", {
				duration: 2000,
				description: lastAutoSaveTime
					? `前回: ${lastAutoSaveTime.toLocaleTimeString()}`
					: undefined,
			});
		} catch (error) {
			console.error("自動保存エラー:", error);
			toast.error("自動保存に失敗しました");
		} finally {
			setIsAutoSaving(false);
		}
	};

	// 入力変更時の自動保存タイマー設定
	const handleContentChange = (value: string | undefined) => {
		const newContent = value || "";
		setTreeContent(newContent);
		setYamlError(null);

		// 既存のタイマーをクリア
		if (autoSaveTimerRef.current) {
			clearTimeout(autoSaveTimerRef.current);
		}

		// 5秒後に自動保存を実行
		autoSaveTimerRef.current = setTimeout(() => {
			handleAutoSave();
		}, 5000);
	};

	// コンポーネントのアンマウント時にタイマーをクリア
	useEffect(() => {
		return () => {
			if (autoSaveTimerRef.current) {
				clearTimeout(autoSaveTimerRef.current);
			}
		};
	}, []);

	// Wikipediaから系統樹を生成
	const handleGenerateFromWikipedia = async () => {
		setIsGenerating(true);
		try {
			// 既存の自動保存タイマーをクリア
			if (autoSaveTimerRef.current) {
				clearTimeout(autoSaveTimerRef.current);
				autoSaveTimerRef.current = null;
			}

			const supabase = createClient();
			const {
				data: { session },
			} = await supabase.auth.getSession();

			const response = await fetch(
				`/api/classifications/${encodeURIComponent(decodedName)}/generate-tree`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${session?.access_token}`,
					},
				},
			);

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || "生成に失敗しました");
			}

			const data = await response.json();
			setTreeContent(data.yaml);
			setOriginalContent(data.yaml);
			toast.success("Wikipediaから系統樹を生成しました");
		} catch (error) {
			console.error("系統樹生成エラー:", error);
			toast.error(
				error instanceof Error ? error.message : "系統樹の生成に失敗しました",
			);
		} finally {
			setIsGenerating(false);
		}
	};

	// 手動保存処理
	const handleSave = async () => {
		if (!user) {
			setAuthDialogOpen(true);
			return;
		}

		setIsSaving(true);
		try {
			const supabase = createClient();
			const {
				data: { session },
			} = await supabase.auth.getSession();

			const response = await fetch(
				`/api/classifications/${encodeURIComponent(decodedName)}/phylogenetic-trees`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${session?.access_token}`,
					},
					body: JSON.stringify({
						content: treeContent,
					}),
				},
			);

			if (!response.ok) {
				throw new Error("保存に失敗しました");
			}

			setOriginalContent(treeContent);
			setLastAutoSaveTime(new Date());
			toast.success("系統樹を保存しました");
		} catch (error) {
			console.error("保存エラー:", error);
			toast.error("保存に失敗しました");
		} finally {
			setIsSaving(false);
		}
	};

	// ファイルダウンロード
	const handleDownload = () => {
		const blob = new Blob([treeContent], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${decodedName}_phylogenetic_tree.yml`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	// ファイルアップロード
	const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (file) {
			const reader = new FileReader();
			reader.onload = (e) => {
				const content = e.target?.result as string;
				setTreeContent(content);
			};
			reader.readAsText(file);
		}
	};

	// 変更があるかどうかをチェック
	const hasChanges = treeContent !== originalContent;

	if (isLoading) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="flex items-center justify-center h-64">
					<div>系統樹データを読み込み中...</div>
				</div>
			</div>
		);
	}

			return (
		<GeologicalAgeProvider>
			<div className="container mx-auto px-4 py-8">
				<AuthDialog
					isOpen={authDialogOpen}
					onClose={() => setAuthDialogOpen(false)}
					mode="login"
				/>
				<div className="flex items-center gap-4 mb-6">
					<Button
						variant="outline"
						onClick={() =>
							router.push(`/classifications/${encodeURIComponent(decodedName)}`)
						}
					>
						<ArrowLeft className="h-4 w-4 lg:mr-2" />
						<span className="hidden lg:inline">戻る</span>
					</Button>
					<h1 className="text-2xl font-bold">系統樹編集: {decodedName}</h1>
					<div className="ml-auto flex items-center gap-2">
						{hasChanges && (
							<div className="text-sm text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-200 mr-2">
								<span className="block lg:hidden">⚠️</span>
								<span className="hidden lg:block">⚠️ 未保存</span>
							</div>
						)}
						{/* 自動保存状態表示 */}
						{isAutoSaving && (
							<div className="text-sm text-blue-600 bg-blue-50 p-2 rounded-lg border border-blue-200 mr-2">
								<span className="block lg:hidden">💾</span>
								<span className="hidden lg:block">💾 自動保存中...</span>
							</div>
						)}
						<Button
							variant="outline"
							size="sm"
							onClick={handleGenerateFromWikipedia}
							disabled={isGenerating}
						>
							<Sparkles className="h-4 w-4 lg:mr-2" />
							<span className="hidden lg:inline">
								{isGenerating ? "生成中..." : "生成"}
							</span>
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleDownload}
							disabled={!treeContent}
						>
							<Download className="h-4 w-4 lg:mr-2" />
							<span className="hidden lg:inline">ダウンロード</span>
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => document.getElementById("file-upload")?.click()}
						>
							<Upload className="h-4 w-4 lg:mr-2" />
							<span className="hidden lg:inline">アップロード</span>
						</Button>
						<Button
							onClick={handleSave}
							disabled={isSaving || !hasChanges || isAutoSaving}
							size="sm"
						>
							<Save className="h-4 w-4 lg:mr-2" />
							<span className="hidden lg:inline">
								{isSaving ? "保存中..." : "保存"}
							</span>
						</Button>
						<input
							id="file-upload"
							type="file"
							accept=".yml,.yaml"
							onChange={handleFileUpload}
							className="hidden"
						/>
					</div>
				</div>

				{/* 編集エリア */}
				<div className="mb-8">
					<Card className="h-full">
						<CardContent className="h-full p-0">
							<MonacoEditor
								height="600px"
									defaultLanguage="yaml"
									theme="vs-dark"
									value={treeContent}
									onChange={handleContentChange}
									options={{
										minimap: { enabled: true },
										scrollBeyondLastLine: false,
										fontSize: 14,
										wordWrap: "on",
										automaticLayout: true,
										theme: "vs-dark",
										lineNumbers: "on",
										glyphMargin: true,
										folding: true,
										lineDecorationsWidth: 10,
										lineNumbersMinChars: 3,
										renderLineHighlight: "all",
										selectOnLineNumbers: true,
										roundedSelection: false,
										readOnly: false,
										cursorStyle: "line",
										contextmenu: true,
										mouseWheelZoom: true,
										quickSuggestions: false,
										wordBasedSuggestions: "off",
										parameterHints: {
											enabled: false,
										},
										tabCompletion: "on",
										tabSize: 2,
										insertSpaces: true,
										wrappingIndent: "indent",
										scrollbar: {
											vertical: "visible",
											horizontal: "visible",
											verticalScrollbarSize: 14,
											horizontalScrollbarSize: 14,
										},
										stickyScroll: {
											enabled: true,
											maxLineCount: 8,
										},
									}}
									onMount={(editor, monaco) => {
										console.log("MonacoEditor onMount");
                                        monaco.languages.registerCompletionItemProvider("yaml", {
                                            triggerCharacters: ["-", "c", "f", "t", "e", "p", "n", "l"],
											provideCompletionItems: (model, position) => {
												const lineContent = model
													.getLineContent(position.lineNumber)
													.slice(0, position.column - 1);
												const indentMatch = lineContent.match(/^\s*/);
												const indentLength = indentMatch
													? indentMatch[0].length
													: 0;
												const startColumn = indentLength + 1;
												const endColumn = position.column;
												const suggestions = [];
												if (/^\s*-$/.test(lineContent)) {
													suggestions.push({
														label: "- name:",
														kind: monaco.languages.CompletionItemKind.Snippet,
														insertText: "- name: ",
														insertTextRules:
															monaco.languages.CompletionItemInsertTextRule
																.InsertAsSnippet,
														range: {
															startLineNumber: position.lineNumber,
															startColumn: startColumn,
															endLineNumber: position.lineNumber,
															endColumn: endColumn,
														},
													});
													console.log("Triggered - name: snippet");
												}
												if (
													/^\s*c$/.test(lineContent) ||
													/^\s*children$/.test(lineContent)
												) {
													suggestions.push({
														label: "children:",
														kind: monaco.languages.CompletionItemKind.Snippet,
														insertText: "children: ",
														insertTextRules:
															monaco.languages.CompletionItemInsertTextRule
																.InsertAsSnippet,
														range: {
															startLineNumber: position.lineNumber,
															startColumn: startColumn,
															endLineNumber: position.lineNumber,
															endColumn: endColumn,
														},
													});
													console.log("Triggered children: snippet");
												}
												if (
													/^\s*f$/.test(lineContent) ||
													/^\s*from$/.test(lineContent)
												) {
													suggestions.push({
														label: "from:",
														kind: monaco.languages.CompletionItemKind.Snippet,
														insertText: "from: ",
														insertTextRules:
															monaco.languages.CompletionItemInsertTextRule
																.InsertAsSnippet,
														range: {
															startLineNumber: position.lineNumber,
															startColumn: startColumn,
															endLineNumber: position.lineNumber,
															endColumn: endColumn,
														},
													});
													console.log("Triggered from: snippet");
												}
												if (
													/^\s*t$/.test(lineContent) ||
													/^\s*to$/.test(lineContent)
												) {
													suggestions.push({
														label: "to:",
														kind: monaco.languages.CompletionItemKind.Snippet,
														insertText: "to: ",
														insertTextRules:
															monaco.languages.CompletionItemInsertTextRule
																.InsertAsSnippet,
														range: {
															startLineNumber: position.lineNumber,
															startColumn: startColumn,
															endLineNumber: position.lineNumber,
															endColumn: endColumn,
														},
													});
													console.log("Triggered to: snippet");
												}
												// en_name補完
												if (/^\s*e$/.test(lineContent)) {
													suggestions.push({
														label: "en_name:",
														kind: monaco.languages.CompletionItemKind.Snippet,
														insertText: "en_name: ",
														insertTextRules:
															monaco.languages.CompletionItemInsertTextRule
																.InsertAsSnippet,
														range: {
															startLineNumber: position.lineNumber,
															startColumn: startColumn,
															endLineNumber: position.lineNumber,
															endColumn: endColumn,
														},
													});
													console.log("Triggered en_name: snippet");
												}
                                                // post_branch補完
												if (/^\s*p$/.test(lineContent)) {
													suggestions.push({
														label: "post_branch:",
														kind: monaco.languages.CompletionItemKind.Snippet,
														insertText: "post_branch: true",
														insertTextRules:
															monaco.languages.CompletionItemInsertTextRule
																.InsertAsSnippet,
														range: {
															startLineNumber: position.lineNumber,
															startColumn: startColumn,
															endLineNumber: position.lineNumber,
															endColumn: endColumn,
														},
													});
													console.log("Triggered post_branch: snippet");
												}
                                                // linked_tree 補完（lで始まる場合）
                                                if (/^\s*l$/.test(lineContent) || /^\s*linked_tree$/.test(lineContent)) {
                                                    suggestions.push({
                                                        label: "linked_tree:",
                                                        kind: monaco.languages.CompletionItemKind.Snippet,
                                                        insertText: "linked_tree: ",
                                                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                                                        range: {
                                                            startLineNumber: position.lineNumber,
                                                            startColumn: startColumn,
                                                            endLineNumber: position.lineNumber,
                                                            endColumn: endColumn,
                                                        },
                                                    });
                                                    console.log("Triggered linked_tree: snippet");
                                                }
												// non_post_leaf補完（nで始まる場合）
												if (/^\s*n$/.test(lineContent)) {
													suggestions.push({
														label: "non_post_leaf:",
														kind: monaco.languages.CompletionItemKind.Snippet,
														insertText: "non_post_leaf: true",
														insertTextRules:
															monaco.languages.CompletionItemInsertTextRule
																.InsertAsSnippet,
														range: {
															startLineNumber: position.lineNumber,
															startColumn: startColumn,
															endLineNumber: position.lineNumber,
															endColumn: endColumn,
														},
													});
													console.log("Triggered non_post_leaf: snippet");
												}
												console.log("suggestions:", suggestions);
												return { suggestions };
											},
										});
										console.log("registerCompletionItemProvider called");
									}}
								/>
							</CardContent>
						</Card>
					</div>

				{/* プレビューエリア */}
				<div className="mb-6">
					<h2 className="text-xl font-semibold mb-4">プレビュー</h2>
					<div
						className="rounded-lg border p-0"
						style={{ width: "100%", height: "900px", position: "relative" }}
					>
						{/* 地質時代カードを右上に重ねて配置 */}
						<div className="absolute top-0 right-0 z-10">
							<GeologicalAgeCard enableMenu={true} />
						</div>
						{treeContent ? (
							<PhylogeneticTreeArea
								customTreeContent={treeContent}
							/>
						) : (
							<div className="flex items-center justify-center h-full text-gray-500">
								<p>YAMLを入力して系統樹をプレビュー</p>
							</div>
						)}
						{yamlError && (
							<div className="absolute bottom-4 left-4 bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded-lg text-sm">
								⚠️ YAMLエラー: {yamlError}
							</div>
						)}
					</div>
				</div>
			</div>
		</GeologicalAgeProvider>
	);
}
