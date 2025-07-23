"use strict";

import {
    commands,
    workspace,
    window,
    Uri,
    QuickPickItem,
    Disposable,
    ProgressLocation,
    FileType,
} from "vscode";

import * as Path from "path";

import { PerforceService } from "./PerforceService";
import * as p4 from "./api/PerforceApi";
import { Display } from "./Display";
import * as PerforceUri from "./PerforceUri";
import { PerforceSCMProvider } from "./ScmProvider";
import * as AnnotationProvider from "./annotations/AnnotationProvider";
import * as DiffProvider from "./DiffProvider";
import * as QuickPicks from "./quickPick/QuickPicks";
import {
    showQuickPick,
    openLastQuickPick,
    chooseRecentQuickPick,
} from "./quickPick/QuickPickProvider";
import { splitBy, pluralise, isTruthy } from "./TsUtils";
import { perforceFsProvider } from "./FileSystemProvider";
import { showRevChooserForFile } from "./quickPick/FileQuickPick";
import { changeSpecEditor, jobSpecEditor } from "./SpecEditor";
import { stderr } from "process";

// TODO resolve
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PerforceCommands {
    export function registerCommands() {
        commands.registerCommand("perforce.add", addOpenFile);
        commands.registerCommand("perforce.edit", editOpenFile);
        commands.registerCommand("perforce.delete", deleteOpenFile);
        commands.registerCommand("perforce.revert", revertOpenFile);
        commands.registerCommand("perforce.submitSingle", submitSingle);
        commands.registerCommand("perforce.syncOpenFile", syncOpenFile);
        commands.registerCommand("perforce.syncOpenFileRevision", syncOpenFileRevision);
        commands.registerCommand("perforce.explorer.syncPath", syncExplorerPath);
        commands.registerCommand("perforce.showOpenFileHistory", showFileHistory);
        commands.registerCommand("perforce.explorer.move", moveExplorerFiles);
        commands.registerCommand("perforce.explorer.add", addExplorerFiles);
        commands.registerCommand("perforce.explorer.edit", editExplorerFiles);
        commands.registerCommand("perforce.explorer.revert", revertExplorerFiles);
        commands.registerCommand(
            "perforce.explorer.revertUnchanged",
            revertExplorerFilesUnchanged
        );
        commands.registerCommand("perforce.explorer.delete", deleteExplorerFiles);
        commands.registerCommand("perforce.move", moveOpenFile);
        commands.registerCommand("perforce.diff", diff);
        commands.registerCommand("perforce.diffRevision", diffRevision);
        commands.registerCommand("perforce.diffPrevious", diffPrevious);
        commands.registerCommand("perforce.diffPreviousFromDiff", diffPreviousFromDiff);
        commands.registerCommand("perforce.diffNext", diffNext);
        commands.registerCommand("perforce.depotActions", showDepotActions);
        commands.registerCommand("perforce.showQuickPick", showQuickPick);
        commands.registerCommand("perforce.showLastQuickPick", openLastQuickPick);
        commands.registerCommand("perforce.showRecentQuickPick", chooseRecentQuickPick);
        commands.registerCommand("perforce.annotate", annotate);
        commands.registerCommand("perforce.opened", opened);
        commands.registerCommand("perforce.logout", logout);
        commands.registerCommand("perforce.login", login);
        commands.registerCommand("perforce.diffFiles", diffFiles);
        commands.registerCommand("perforce.menuFunctions", menuFunctions);
        commands.registerCommand("perforce.saveJobSpec", inputOpenJobSpec);
        commands.registerCommand("perforce.saveChangeSpec", inputOpenChangeSpec);
        commands.registerCommand("perforce.refreshJobSpec", refreshOpenJobSpec);
        commands.registerCommand("perforce.refreshChangeSpec", refreshOpenChangeSpec);
    }

    export function registerImportantCommands(subscriptions: Disposable[]) {
        subscriptions.push(
            commands.registerCommand(
                "perforce.editAndSave",
                editAndSaveOpenFileOrPassthrough
            )
        );
    }

    function addOpenFile() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        p4add(editor.document.uri);
    }

    export async function p4add(fileUri: Uri) {
        try {
            await p4.add(fileUri, { files: [fileUri] });
            Display.showMessage("File opened for add");
            Display.updateEditor();
        } catch {}
        PerforceSCMProvider.RefreshAll();
    }

    function editOpenFile() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        p4edit(editor.document.uri);
    }

    async function editAndSaveOpenFileOrPassthrough() {
        const activeFile = window.activeTextEditor?.document;
        if (!activeFile) {
            // pass through to the save action in case it can do anything else
            await commands.executeCommand("workbench.action.files.save");
        } else {
            try {
                await window.withProgress(
                    {
                        location: ProgressLocation.Notification,
                        title: "Perforce: Opening file for edit",
                    },
                    () => p4edit(activeFile.uri)
                );
            } catch (err) {
                // ensure save always happens even if something goes wrong
                Display.showError(err);
            }

            await activeFile.save();
        }
    }

    export async function p4edit(fileUri: Uri) {
        try {
            await p4.edit(fileUri, { files: [fileUri] });
            Display.showMessage("File opened for edit");
            Display.updateEditor();
        } catch {}
        PerforceSCMProvider.RefreshAll();
    }

    export async function deleteOpenFile() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        const fileUri = editor.document.uri;
        await p4revertAndDelete(fileUri);
    }

    export async function p4delete(fileUri: Uri, resource?: Uri) {
        const deleteOpts: p4.DeleteOptions = { paths: [fileUri] };
        try {
            await p4.del(resource ?? fileUri, deleteOpts);
            Display.showMessage(PerforceUri.fsPathWithoutRev(fileUri) + " deleted.");
            Display.updateEditor();
            PerforceSCMProvider.RefreshAll();
        } catch (err) {
            // no work - just catch exception.  Error will be
            // reported by perforce command code
        }
    }

    export async function revertOpenFile() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        const fileUri = editor.document.uri;

        const filename = PerforceUri.basenameWithoutRev(fileUri);
        const ok = await Display.requestConfirmation(
            "Are you sure you want to revert " + filename + "?",
            "Revert " + filename
        );

        if (ok) {
            await p4revert(fileUri);
        }
    }

    export async function p4revert(fileUri: Uri, resource?: Uri) {
        const revertOpts: p4.RevertOptions = { paths: [fileUri] };
        try {
            await p4.revert(resource ?? fileUri, revertOpts);
            Display.showMessage(PerforceUri.basenameWithoutRev(fileUri) + " reverted.");
            Display.updateEditor();
            PerforceSCMProvider.RefreshAll();
        } catch (err) {
            // no work - just catch exception.  Error will be
            // reported by perforce command code
        }
    }

    export async function p4revertAndDelete(uri: Uri, resource?: Uri) {
        await PerforceCommands.p4revert(uri, resource);
        await PerforceCommands.p4delete(uri, resource);
    }

    export async function submitSingle() {
        const file = window.activeTextEditor?.document.uri;
        if (!file || file.scheme !== "file") {
            Display.showError("No open file to submit");
            return;
        }

        if (window.activeTextEditor?.document.isDirty) {
            Display.showModalMessage(
                "The active document has unsaved changes. Save the file first!"
            );
            return;
        }
        const description = await window.showInputBox({
            prompt:
                "Enter a changelist description to submit '" +
                PerforceUri.fsPathWithoutRev(file) +
                "'",
            validateInput: (input) => {
                if (!input.trim()) {
                    return "Description must not be empty";
                }
            },
        });
        if (!description) {
            return;
        }

        const output = await p4.submitChangelist(file, { description, file });
        didChangeHaveRev(file);
        PerforceSCMProvider.RefreshAll();
        Display.showMessage("Changelist " + output.chnum + " submitted");
    }

    async function pickRevision(uri: Uri, placeHolder: string) {
        const revisions = await p4.getFileHistory(uri, {
            file: uri,
            followBranches: false,
            omitNonContributoryIntegrations: true,
        });

        const items = revisions
            .filter((rev, _i, arr) => rev.file === arr[0].file) // ignore pre-renamed files
            .map((rev) => {
                return {
                    label: `#${rev.revision} change: ${rev.chnum}`,
                    description: rev.description,
                    item: rev,
                };
            });

        const chosen = await window.showQuickPick(items, { placeHolder });

        return chosen?.item;
    }

    function didChangeHaveRev(uri: Uri) {
        perforceFsProvider()?.requestUpdatedDocument(
            PerforceUri.fromUriWithRevision(uri, "have")
        );
    }

    export async function syncOpenFile() {
        const file = window.activeTextEditor?.document.uri;
        if (!file || file.scheme !== "file") {
            Display.showError("No open file to sync");
            return;
        }

        try {
            await p4.sync(file, { files: [file] });
            Display.showMessage("File Synced");
            didChangeHaveRev(file);
        } catch {}
        PerforceSCMProvider.RefreshAll();
    }

    export async function syncOpenFileRevision() {
        const file = window.activeTextEditor?.document.uri;
        if (!file || file.scheme !== "file") {
            Display.showError("No open file to sync");
            return;
        }

        const revision = await pickRevision(file, "Choose a revision to sync");

        if (revision) {
            const chosen = PerforceUri.fromDepotPath(
                file,
                revision.file,
                revision.revision
            );
            try {
                await p4.sync(file, { files: [chosen] });
                Display.showMessage("File Synced");
                didChangeHaveRev(file);
            } catch {}
            PerforceSCMProvider.RefreshAll();
        }
    }

    function withExplorerProgress(func: () => Promise<any>) {
        return window.withProgress(
            { location: { viewId: "workbench.view.explorer" } },
            func
        );
    }

    // accepts a string for any custom tasks etc
    export async function syncExplorerPath(file: Uri | string, files?: Uri[]) {
        return explorerOperationByDir(
            file,
            files,
            (dirFiles, resource) => p4.sync(resource, { files: dirFiles }),
            { message: "Sync complete", hideSubErrors: true }
        );
    }

    async function moveOneDir(file: Uri, newFsPath: string) {
        const fromWild = Path.join(file.fsPath, "...");
        const toWild = Path.join(newFsPath, "...");
        try {
            await p4.edit.ignoringAndHidingStdErr(file, { files: [fromWild] });
            await p4.move(file, { fromToFile: [fromWild, toWild] });
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    async function moveOneFile(file: Uri, newFsPath: string) {
        try {
            await p4.edit.ignoringAndHidingStdErr(file, { files: [file] });
            await p4.move(file, { fromToFile: [file, newFsPath] });
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    async function isDir(file: Uri): Promise<boolean> {
        try {
            return (await workspace.fs.stat(file)).type === FileType.Directory;
        } catch (err) {
            return false;
        }
    }

    async function moveOne(file: Uri, newFsPath: string) {
        if (await isDir(file)) {
            await moveOneDir(file, newFsPath);
        } else {
            await moveOneFile(file, newFsPath);
        }
    }

    async function moveMultipleToNewDir(files: Uri[]) {
        const dirname = Path.dirname(files[0].fsPath);
        const differentDir = files.find((file) => Path.dirname(file.fsPath) !== dirname);
        if (differentDir) {
            Display.showModalMessage(
                "To move multiple files, all moved files must be within the same folder"
            );
            return;
        }
        const newPath = await window.showInputBox({
            prompt: "Enter the new location for the " + files.length + " selected files",
            value: dirname,
            placeHolder: dirname,
            valueSelection: getDirSelectionRange(dirname),
        });
        if (newPath) {
            const promises = files.map((file) =>
                moveOne(file, Path.join(newPath, Path.basename(file.fsPath)))
            );
            try {
                await withExplorerProgress(() => Promise.all(promises));
            } catch (err) {
                Display.showImportantError(err.toString());
            }
            PerforceSCMProvider.RefreshAll();
        }
    }

    function getDirSelectionRange(file: string): [number, number] {
        const dirname = Path.dirname(file);
        return [dirname.length + 1, file.length];
    }

    async function moveRenameSingleFileOrDir(file: Uri, openInEditor?: boolean) {
        const newPath = await window.showInputBox({
            prompt: "Enter the new path for " + Path.basename(file.fsPath),
            value: file.fsPath,
            placeHolder: file.fsPath,
            valueSelection: getDirSelectionRange(file.fsPath),
        });
        if (newPath) {
            try {
                await withExplorerProgress(() => moveOne(file, newPath));
                if (openInEditor === true) {
                    await window.showTextDocument(Uri.file(newPath));
                }
            } catch (err) {
                Display.showImportantError(err.toString());
            }
            PerforceSCMProvider.RefreshAll();
        }
    }

    export async function moveExplorerFiles(selected: Uri, all: Uri[]) {
        if (all.length > 1) {
            await moveMultipleToNewDir(all);
        } else {
            await moveRenameSingleFileOrDir(
                selected,
                window.activeTextEditor?.document.uri.fsPath === selected.fsPath
            );
        }
    }

    function consolidateUris(file: Uri | string, all?: Uri[]) {
        const allUris = all ?? [];
        const resource = typeof file === "string" ? PerforceUri.parse(file) : file;
        return [resource, ...allUris.filter((f) => f.fsPath !== resource.fsPath)];
    }

    type FileAndDir = {
        file: Uri;
        isDir: boolean;
        dir: Uri;
    };

    async function mapToFilesByDir(files: Uri[]): Promise<FileAndDir[]> {
        return await Promise.all(
            files.map(async (file) => {
                const fileIsDir = await isDir(file);
                return {
                    file: fileIsDir ? Uri.file(Path.join(file.fsPath, "...")) : file,
                    isDir: fileIsDir,
                    dir: fileIsDir ? file : Uri.file(Path.dirname(file.fsPath)),
                };
            })
        );
    }

    async function explorerOperationByDir(
        selected: Uri | string,
        all: Uri[] | undefined,
        op: (files: Uri[], resource: Uri) => Promise<any>,
        options?: {
            message?: string;
            hideSubErrors?: boolean;
        }
    ) {
        const files = consolidateUris(selected, all);
        const filesByDir = await mapToFilesByDir(files);

        const promises = splitBy(filesByDir, (file) => file.dir.fsPath).map(
            async (dirFiles) => {
                try {
                    await op(
                        dirFiles.map((file) => file.file),
                        dirFiles[0].dir
                    );
                } catch (err) {
                    if (!options?.hideSubErrors) {
                        Display.showImportantError(err);
                    }
                    throw err;
                } finally {
                    dirFiles.forEach((file) => {
                        if (!file.isDir) {
                            didChangeHaveRev(file.file);
                        }
                    });
                }
            }
        );

        try {
            await withExplorerProgress(() => Promise.all(promises));
            Display.showMessage(options?.message ?? "Operation complete");
        } catch (err) {}
        PerforceSCMProvider.RefreshAll();
        Display.updateEditor();
    }

    export function addExplorerFiles(selected: Uri | string, all?: Uri[]) {
        return explorerOperationByDir(selected, all, (dirFiles, resource) =>
            p4.add(resource, { files: dirFiles })
        );
    }

    export function editExplorerFiles(selected: Uri | string, all?: Uri[]) {
        return explorerOperationByDir(selected, all, (dirFiles, resource) =>
            p4.edit(resource, { files: dirFiles })
        );
    }

    async function fileAndFolderCount(files: Uri[]) {
        const dirCount = (await Promise.all(files.map((f) => isDir(f)))).filter(isTruthy)
            .length;
        const fileCount = files.length - dirCount;
        const items = [
            fileCount > 0 ? pluralise(fileCount, "file") : undefined,
            dirCount > 0 ? "ALL FILES in " + pluralise(dirCount, "folder") : undefined,
        ].filter(isTruthy);
        return items.join(", and ");
    }

    export async function revertExplorerFiles(selected: Uri | string, all?: Uri[]) {
        const allFiles = consolidateUris(selected, all);
        const allPlural = await fileAndFolderCount(allFiles);
        const ok = await Display.requestConfirmation(
            "Are you sure you want to revert " + allPlural + "?",
            "Revert " + allPlural
        );
        if (ok) {
            await explorerOperationByDir(
                selected,
                all,
                (dirFiles, resource) => p4.revert(resource, { paths: dirFiles }),
                { hideSubErrors: true }
            );
        }
    }

    export function revertExplorerFilesUnchanged(selected: Uri | string, all?: Uri[]) {
        return explorerOperationByDir(
            selected,
            all,
            (dirFiles, resource) =>
                p4.revert(resource, { paths: dirFiles, unchanged: true }),
            { hideSubErrors: true }
        );
    }

    export async function deleteExplorerFiles(selected: Uri | string, all?: Uri[]) {
        const allFiles = consolidateUris(selected, all);
        const allPlural = await fileAndFolderCount(allFiles);
        const ok = await Display.requestConfirmation(
            "Are you sure you want to delete " +
                allPlural +
                "?\nThis operation does not revert open files",
            "Delete " + allPlural
        );
        if (ok) {
            await explorerOperationByDir(selected, all, (dirFiles, resource) =>
                p4.del(resource, { paths: dirFiles })
            );
        }
    }

    export async function moveOpenFile() {
        const file = window.activeTextEditor?.document.uri;
        if (!file || file.scheme !== "file") {
            Display.showError("No open file to sync");
            return;
        }

        await moveRenameSingleFileOrDir(file, true);
    }

    export async function diff(revision?: number) {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!checkFolderOpened()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        const doc = editor.document;

        if (!doc.isUntitled) {
            if (!revision) {
                await diffPrevious(editor.document.uri);
                return;
            }

            const revStr = revision && !isNaN(revision) ? revision.toString() : "have";
            const depotUri = PerforceUri.fromUriWithRevision(doc.uri, revStr);
            const rightUri = doc.uri;

            await DiffProvider.diffFiles(depotUri, rightUri);
        }
    }

    export async function diffRevision() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!checkFolderOpened()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        const doc = editor.document;

        const revision = await pickRevision(doc.uri, "Choose a revision to diff against");
        if (revision) {
            diff(parseInt(revision.revision));
        }
    }

    async function diffPrevious(fromDoc?: Uri) {
        if (!fromDoc) {
            fromDoc = window.activeTextEditor?.document.uri;
        }
        if (!fromDoc) {
            Display.showError("No file to diff");
            return false;
        }
        await DiffProvider.diffPrevious(fromDoc);
    }

    async function diffPreviousFromDiff() {
        const fromDoc = window.activeTextEditor?.document.uri;
        if (!fromDoc) {
            Display.showError("No file to diff");
            return false;
        }
        await DiffProvider.diffPrevious(fromDoc, true);
    }

    async function diffNext(fromDoc?: Uri) {
        if (!fromDoc) {
            fromDoc = window.activeTextEditor?.document.uri;
        }
        if (!fromDoc) {
            Display.showError("No file to diff");
            return false;
        }
        await DiffProvider.diffNext(fromDoc);
    }

    async function diffFiles(leftFile: Uri, rightFile: Uri) {
        await DiffProvider.diffFiles(leftFile, rightFile);
    }

    function getOpenDocUri(): Uri | undefined {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return;
        }

        if (!editor || !editor.document) {
            return;
        }

        const doc = editor.document;
        return doc.uri;
    }

    async function showDepotActions() {
        // DO NOT USE URI from vscode command - only returns the right uri - we need the active editor
        const fromDoc = window.activeTextEditor?.document.uri;
        if (!fromDoc) {
            Display.showError("No document selected");
            return;
        }
        await QuickPicks.showQuickPickForFile(fromDoc);
    }

    export async function annotate(file?: Uri) {
        const uri = file ?? getOpenDocUri();

        if (!uri) {
            return false;
        }
        await window.withProgress(
            {
                location: ProgressLocation.Window,
                cancellable: false,
                title: "Generating annotations",
            },
            () => AnnotationProvider.annotate(uri)
        );
    }

    export function opened() {
        if (!checkFolderOpened()) {
            return false;
        }
        if (!workspace.workspaceFolders) {
            return false;
        }
        let resource = workspace.workspaceFolders[0].uri;
        if (workspace.workspaceFolders.length > 1) {
            // try to find the proper workspace
            if (window.activeTextEditor && window.activeTextEditor.document) {
                const wksFolder = workspace.getWorkspaceFolder(
                    window.activeTextEditor.document.uri
                );
                if (wksFolder) {
                    resource = wksFolder.uri;
                }
            }
        }

        PerforceService.execute(resource, "opened", (result) => {
            //p4-node
            const err = false;
            const stderr = false;
            if (err) {
                Display.showError("err.message");
            } else if (stderr) {
                Display.showError("stderr".toString());
            } else {
                const opened = "stdout".toString().trim().split("\n");
                if (opened.length === 0) {
                    return false;
                }

                const options = opened.map((file) => {
                    return {
                        description: file,
                        label: Path.basename(file),
                    };
                });

                window
                    .showQuickPick(options, { matchOnDescription: true })
                    .then((selection) => {
                        if (!selection) {
                            return false;
                        }

                        const depotPath = selection.description;
                        const whereFile = depotPath.substring(0, depotPath.indexOf("#"));
                        where(resource, whereFile)
                            .then((result) => {
                                // https://www.perforce.com/perforce/r14.2/manuals/cmdref/p4_where.html
                                const results = result.split(" ");
                                if (results.length >= 3) {
                                    const fileToOpen = results[2].trim();
                                    workspace.openTextDocument(Uri.file(fileToOpen)).then(
                                        (document) => {
                                            window.showTextDocument(document);
                                        },
                                        (reason) => {
                                            Display.showError(reason);
                                        }
                                    );
                                }
                            })
                            .catch((reason) => {
                                Display.showError(reason);
                            });
                    });
            }
        });
    }

    function where(resource: Uri, file: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!checkFolderOpened()) {
                reject();
                return;
            }

            const args = [file];
            //p4-node
            PerforceService.execute(
                resource,
                "where",
                (result) => {
                    const err = false;
                    const stderr = false;
                    if (err) {
                        Display.showError("err.message");
                        reject(err);
                    } else if (stderr) {
                        Display.showError("stderr".toString());
                        reject(stderr);
                    } else {
                        resolve("stdout".toString());
                    }
                },
                args
            );
        });
    }

    // Try to guess the proper workspace to use
    function guessWorkspaceUri(): Uri {
        if (window.activeTextEditor && !window.activeTextEditor.document.isUntitled) {
            return window.activeTextEditor.document.uri;
        }

        if (workspace.workspaceFolders) {
            return workspace.workspaceFolders[0].uri;
        }

        return Uri.parse("");
    }

    export async function logout() {
        const resource = guessWorkspaceUri();

        await Display.doLogoutFlow(resource);
    }

    export async function login() {
        const resource = guessWorkspaceUri();

        const ok = await Display.doLoginFlow(resource);
        if (ok) {
            PerforceSCMProvider.RefreshAll();
        }
    }

    async function inputOpenJobSpec() {
        const doc = window.activeTextEditor?.document;
        if (!doc) {
            return;
        }
        await jobSpecEditor.inputSpec(doc);
    }

    async function inputOpenChangeSpec() {
        const doc = window.activeTextEditor?.document;
        if (!doc) {
            return;
        }
        await changeSpecEditor.inputSpec(doc);
    }

    async function refreshOpenJobSpec() {
        const doc = window.activeTextEditor?.document;
        if (!doc) {
            return;
        }
        await jobSpecEditor.refreshSpec(doc);
    }

    async function refreshOpenChangeSpec() {
        const doc = window.activeTextEditor?.document;
        if (!doc) {
            return;
        }
        await changeSpecEditor.refreshSpec(doc);
    }

    function showFileHistory() {
        const file = window.activeTextEditor?.document.uri;
        if (!file) {
            return;
        }
        return showRevChooserForFile(PerforceUri.fromUriWithRevision(file, "have"));
    }

    export function menuFunctions() {
        const items: QuickPickItem[] = [];
        items.push({
            label: "add",
            description: "Open a new file to add it to the depot",
        });
        items.push({ label: "edit", description: "Open an existing file for edit" });
        items.push({
            label: "revert",
            description: "Discard changes from an opened file",
        });
        items.push({
            label: "submit single file",
            description: "Submit the open file, ONLY if it is in the default changelist",
        });
        items.push({
            label: "move",
            description: "Move or rename the open file",
        });
        items.push({
            label: "sync file",
            description: "Sync the file to the latest revision",
        });
        items.push({
            label: "sync revision",
            description: "Choose a revision to sync",
        });
        items.push({
            label: "diff",
            description: "Display diff of client file with depot file",
        });
        items.push({
            label: "diffRevision",
            description:
                "Display diff of client file with depot file at a specific revision",
        });
        items.push({
            label: "annotate",
            description: "Print file lines and their revisions",
        });
        items.push({
            label: "history",
            description: "Show file history",
        });
        items.push({
            label: "opened",
            description: "View 'open' files and open one in editor",
        });
        items.push({ label: "login", description: "Log in to Perforce" });
        items.push({ label: "logout", description: "Log out from Perforce" });
        window
            .showQuickPick(items, {
                matchOnDescription: true,
                placeHolder: "Choose a Perforce command:",
            })
            .then(function (selection) {
                if (selection === undefined) {
                    return;
                }
                switch (selection.label) {
                    case "add":
                        addOpenFile();
                        break;
                    case "edit":
                        editOpenFile();
                        break;
                    case "revert":
                        revertOpenFile();
                        break;
                    case "move":
                        moveOpenFile();
                        break;
                    case "submit single file":
                        submitSingle();
                        break;
                    case "sync file":
                        syncOpenFile();
                        break;
                    case "sync revision":
                        syncOpenFileRevision();
                        break;
                    case "diff":
                        diff();
                        break;
                    case "diffRevision":
                        diffRevision();
                        break;
                    case "annotate":
                        annotate();
                        break;
                    case "opened":
                        opened();
                        break;
                    case "login":
                        login();
                        break;
                    case "logout":
                        logout();
                        break;
                    case "history":
                        showFileHistory();
                        break;
                    default:
                        break;
                }
            });
    }

    function checkFileSelected() {
        if (!window.activeTextEditor) {
            Display.showMessage("No file selected");
            return false;
        }

        return true;
    }

    export function checkFolderOpened() {
        if (workspace.workspaceFolders === undefined) {
            Display.showMessage("No folder selected");
            return false;
        }

        return true;
    }
}
