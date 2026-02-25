import { flagMapper, makeSimpleCommand, asyncOuputHandler } from "../CommandUtils";
import { PerforceFile, NoOpts } from "../CommonTypes";
import * as vscode from "vscode";
import * as PerforceUri from "../../PerforceUri";
import { isTruthy } from "../../TsUtils";

export type DeleteChangelistOptions = {
    chnum: string;
};

// TODO: Delete Changelist test
const deleteChangelistFlags = flagMapper<DeleteChangelistOptions>([["d", "chnum"]]);

export const deleteChangelist = makeSimpleCommand("change", deleteChangelistFlags, () => {
    return { logStdOut: true };
});

export type SubmitChangelistOptions = {
    chnum?: string;
    description?: string;
    file?: PerforceFile;
};

const submitFlags = flagMapper<SubmitChangelistOptions>(
    [
        ["c", "chnum"],
        ["d", "description"],
    ],
    "file",
);

// TODO: Submit Changelist test
const submitChangelistCommand = makeSimpleCommand("submit", submitFlags, () => {
    return { logStdOut: true };
});

function parseSubmitOutput(output: string) {
    const matches = /Change (\d+) submitted/.exec(output);
    return {
        rawOutput: output,
        chnum: matches?.[1],
    };
}

export const submitChangelist = asyncOuputHandler(
    submitChangelistCommand,
    parseSubmitOutput,
);

export interface RevertOptions {
    paths: PerforceFile[];
    chnum?: string;
    unchanged?: boolean;
}

const revertFlags = flagMapper<RevertOptions>(
    [
        ["a", "unchanged"],
        ["c", "chnum"],
    ],
    "paths",
    undefined,
    { ignoreRevisionFragments: true },
);

export const revert = makeSimpleCommand("revert", revertFlags, () => {
    return { logStdOut: true };
});

export interface DeleteOptions {
    chnum?: string;
    paths: PerforceFile[];
}

const deleteFlags = flagMapper<DeleteOptions>([["c", "chnum"]], "paths");

export const del = makeSimpleCommand("delete", deleteFlags, () => {
    return { logStdOut: true };
});

//#region Shelving

export interface ShelveOptions {
    chnum?: string;
    force?: boolean;
    delete?: boolean;
    paths?: PerforceFile[];
}

const shelveFlags = flagMapper<ShelveOptions>(
    [
        ["f", "force"],
        ["d", "delete"],
        ["c", "chnum"],
    ],
    "paths",
);

export const shelve = makeSimpleCommand("shelve", shelveFlags, () => {
    return { logStdOut: true };
});

export interface UnshelveOptions {
    shelvedChnum: string;
    toChnum?: string;
    force?: boolean;
    branchMapping?: string;
    paths?: PerforceFile[];
}

const unshelveFlags = flagMapper<UnshelveOptions>(
    [
        ["f", "force"],
        ["s", "shelvedChnum"],
        ["c", "toChnum"],
        ["b", "branchMapping"],
    ],
    "paths",
);

export type UnshelvedFiles = {
    files: UnshelvedFile[];
    warnings: ResolveWarning[];
};

type ResolveWarning = {
    depotPath: string;
    resolvePath: string;
};

type UnshelvedFile = {
    depotPath: string;
    operation: string;
};

function isUnshelvedFile(obj: any): obj is UnshelvedFile {
    return obj && obj.depotPath !== undefined && obj.operation !== undefined;
}

function isResolveWarning(obj: any): obj is ResolveWarning {
    return obj && obj.depotPath !== undefined && obj.resolvePath !== undefined;
}

function parseResolveMessage(item: { raw?: string }): ResolveWarning | undefined {
    if (!item.raw) {
        return undefined;
    }
    const matches = /(.*?) - must resolve (.*?) before submitting/.exec(item.raw);
    if (matches) {
        const [, depotPath, resolvePath] = matches;
        return {
            depotPath,
            resolvePath,
        };
    }
}

function parseUnshelveMessage(item: object): UnshelvedFile | undefined {
    const typedItem = item as { depotFile?: string; action?: string };
    if (typedItem === null || !typedItem.depotFile || !typedItem.action) {
        return undefined;
    }
    return {
        depotPath: typedItem.depotFile,
        operation: typedItem.action,
    };
}

function parseUnshelveLine(item: any) {
    if (Object.keys(item).includes("depotFile")) {
        return parseUnshelveMessage(item);
    }
    return parseResolveMessage(item);
}

function parseUnshelveOutput(output: string): UnshelvedFiles {
    const jsonOutput = JSON.parse(output);
    if (!Array.isArray(jsonOutput)) {
        return { files: [], warnings: [] };
    }
    const parsed = jsonOutput.map((item) => parseUnshelveLine(item)).filter(isTruthy);
    return {
        files: parsed.filter(isUnshelvedFile),
        warnings: parsed.filter(isResolveWarning),
    };
}

const unshelveCommand = makeSimpleCommand("unshelve", unshelveFlags, () => {
    return { logStdOut: true };
});

export const unshelve = asyncOuputHandler(unshelveCommand, parseUnshelveOutput);

//#endregion

export interface FixJobOptions {
    chnum: string;
    jobId: string;
    removeFix?: boolean;
}

const fixJobFlags = flagMapper<FixJobOptions>(
    [
        ["c", "chnum"],
        ["d", "removeFix"],
    ],
    "jobId",
);

export const fixJob = makeSimpleCommand("fix", fixJobFlags);

export interface ReopenOptions {
    chnum: string;
    files: PerforceFile[];
}

const reopenFlags = flagMapper<ReopenOptions>([["c", "chnum"]], "files");

export const reopenFiles = makeSimpleCommand("reopen", reopenFlags);

export interface SyncOptions {
    files?: PerforceFile[];
}

const syncFlags = flagMapper<SyncOptions>([], "files");

export const sync = makeSimpleCommand("sync", syncFlags, (opts) => {
    if (opts.files) {
        return { logStdOut: true };
    }
});

function parseInfo(output: string): Map<string, string> {
    const map = new Map<string, string>();
    let stdout = "";

    //p4-node: Convest json object string to normal string
    JSON.parse(output).forEach((data: any) => {
        if (typeof data === "string") {
            stdout += data + "\n";
        } else if (typeof data === "object") {
            // Convert object to key: value format
            Object.entries(data).forEach(([key, value]) => {
                stdout += `${key}: ${value}\n`;
            });
        } else {
            stdout += JSON.stringify(data) + "\n";
        }
    });

    const lines = stdout.trim().split(/\r?\n/);

    for (let i = 0, n = lines.length; i < n; ++i) {
        // Property Name: Property Value
        const matches = /([^:]+): (.+)/.exec(lines[i]);

        if (matches) {
            map.set(matches[1], matches[2]);
        }
    }

    return map;
}

export const info = makeSimpleCommand("info", () => []);

export const getInfo = asyncOuputHandler(info, parseInfo);

export interface HaveFileOptions {
    file: PerforceFile;
}

const haveFileFlags = flagMapper<HaveFileOptions>([], "file", [], {
    ignoreRevisionFragments: true,
});

export type HaveFile = {
    depotPath: string;
    revision: string;
    depotUri: vscode.Uri;
    localUri: vscode.Uri;
};

function parseHaveOutput(resource: vscode.Uri, output: string): HaveFile | undefined {
    try {
        const haveData = JSON.parse(output);
        if (!Array.isArray(haveData) || haveData.length === 0) {
            return undefined;
        }
        const fileData = haveData[0];
        const depotPath = fileData.depotFile;
        const revision = fileData.haveRev;
        const localPath = fileData.path;
        const depotUri = PerforceUri.fromDepotPath(resource, depotPath, revision);
        const localUri = vscode.Uri.file(localPath);

        return { depotPath, revision, depotUri, localUri };
    } catch (error) {
        return undefined;
    }
}

// TODO tidy this up

const haveFileCmd = makeSimpleCommand("have", haveFileFlags);

/**
 * Checks if we `have` a file.
 * @param resource Context for where to run the command
 * @param options Options for the command
 * @returns a perforce URI representing the depot path, revision etc
 */
export async function have(resource: vscode.Uri, options: HaveFileOptions) {
    const output = await haveFileCmd.ignoringStdErr(resource, options);
    return parseHaveOutput(resource, output);
}

// if stdout has any value, we have the file (stderr indicates we don't)
export const haveFile = asyncOuputHandler(haveFileCmd.ignoringAndHidingStdErr, isTruthy);

export type LoginOptions = {
    password: string;
};

export const login = makeSimpleCommand(
    "login",
    () => [],
    (options: LoginOptions) => {
        return {
            input: options.password,
        };
    },
);

const getLoggedInStatus = makeSimpleCommand<NoOpts>("login", () => ["-s"]);

export async function isLoggedIn(resource: vscode.Uri): Promise<boolean> {
    try {
        const p4UserNotLoggedInMessage = "Perforce password (P4PASSWD) invalid or unset";
        const loginStatus = await getLoggedInStatus(resource, {});
        return !(
            typeof loginStatus === "string" &&
            loginStatus.includes(p4UserNotLoggedInMessage)
        );
    } catch {
        return false;
    }
}

export const logout = makeSimpleCommand<NoOpts>("logout", () => []);

export type ResolveOptions = {
    chnum?: string;
    reresolve?: boolean;
    files?: PerforceFile[];
};

const resolveFlags = flagMapper<ResolveOptions>(
    [
        ["c", "chnum"],
        ["f", "reresolve"],
    ],
    "files",
    [],
    {
        ignoreRevisionFragments: true,
    },
);

export const resolve = makeSimpleCommand("resolve", resolveFlags, () => {
    return { useTerminal: true };
});

export type AddOptions = {
    chnum?: string;
    files: PerforceFile[];
};
const addFlags = flagMapper<AddOptions>([["c", "chnum"]], "files", undefined, {
    ignoreRevisionFragments: true,
});

export const add = makeSimpleCommand("add", addFlags, () => {
    return { logStdOut: true };
});

export type EditOptions = {
    chnum?: string;
    files: PerforceFile[];
};
const editFlags = flagMapper<EditOptions>([["c", "chnum"]], "files", undefined, {
    ignoreRevisionFragments: true,
});

export const edit = makeSimpleCommand("edit", editFlags, () => {
    return { logStdOut: true };
});

export type MoveOptions = {
    chnum?: string;
    fromToFile: [PerforceFile, PerforceFile];
};
const moveFlags = flagMapper<MoveOptions>([["c", "chnum"]], "fromToFile");

export const move = makeSimpleCommand("move", moveFlags, () => {
    return { logStdOut: true };
});
