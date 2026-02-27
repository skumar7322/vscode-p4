import { flagMapper, makeSimpleCommand, asyncOuputHandler } from "../CommandUtils";
import { ChangeInfo, PerforceFile } from "../CommonTypes";
import { isTruthy, parseDate } from "../../TsUtils";

export enum ChangelistStatus {
    PENDING = "pending",
    SHELVED = "shelved",
    SUBMITTED = "submitted",
}

export interface ChangesOptions {
    client?: string;
    status?: ChangelistStatus;
    user?: string;
    maxChangelists?: number;
    files?: PerforceFile[];
}

const changes = makeSimpleCommand(
    "changes",
    flagMapper<ChangesOptions>(
        [
            ["c", "client"],
            ["s", "status"],
            ["u", "user"],
            ["m", "maxChangelists"],
        ],
        "files",
        ["-l"],
    ),
);

function parseChangelist(changeData: Record<string, string>): ChangeInfo | undefined {
    if (!changeData || !changeData.change) {
        return undefined;
    }

    // desc may contain literal \n (backslash-n) or actual newlines
    const rawDesc = changeData.desc || "";
    const description = rawDesc
        .replace(/\\n/g, "\n") // Convert literal \n to actual newline
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    return {
        chnum: changeData.change,
        user: changeData.user,
        client: changeData.client,
        description,
        isPending: changeData.status === "pending",
        date: changeData.time ? parseDate(changeData.time) : undefined,
    };
}

function parseChangesOutput(output: string): ChangeInfo[] {
    const changelists = JSON.parse(output) as Record<string, string>[];
    if (!Array.isArray(changelists)) {
        return [];
    }
    return changelists.map(parseChangelist).filter(isTruthy);
}

export const getChangelists = asyncOuputHandler(changes, parseChangesOutput);
