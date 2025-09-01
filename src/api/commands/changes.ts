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
        ["-l"]
    )
);

function parseChangelist(changeData: any): ChangeInfo | undefined {
    if (!changeData || typeof changeData !== "object") {
        return undefined;
    }

    const chnum = changeData.change;
    const user = changeData.user;
    const client = changeData.client;
    const timeStr = changeData.time;
    const description = changeData.desc
        ? changeData.desc.split("\\n").filter((line: string) => line.trim())
        : [];
    const isPending = changeData.status === "pending";

    return {
        chnum,
        user,
        client,
        description,
        isPending,
        date: timeStr ? parseDate(timeStr) : undefined,
    };
}

function parseChangesOutput(output: string): ChangeInfo[] {
    try {
        const changelists = JSON.parse(output);
        if (!Array.isArray(changelists)) {
            return [];
        }

        return changelists.map(parseChangelist).filter(isTruthy);
    } catch (error) {
        return [];
    }
}

export const getChangelists = asyncOuputHandler(changes, parseChangesOutput);
