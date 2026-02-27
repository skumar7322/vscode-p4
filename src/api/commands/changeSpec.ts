import { pipe } from "@arrows/composition";
import {
    concatIfOutputIsDefined,
    flagMapper,
    makeSimpleCommand,
    asyncOuputHandler,
    splitIntoLines,
} from "../CommandUtils";
import { RawField, ChangeSpec } from "../CommonTypes";
import { findFieldValue, parseSpecString } from "../SpecParser";

// Create or update Changelist from spec - p4 change -i
const getChangeAsRawField = (spec: ChangeSpec) =>
    spec.change ? { name: "Change", value: [spec.change] } : undefined;

const getDescriptionAsRawField = (spec: ChangeSpec) =>
    spec.description
        ? { name: "Description", value: splitIntoLines(spec.description) }
        : undefined;

//TODO: Action is not provided by p4-node, so we can't populate it in the spec editor currently. We can add support for this in the future if needed.
const getFilesAsRawField = (spec: ChangeSpec) =>
    spec.files
        ? {
              name: "Files",
              value: spec.files.map((file) => file.depotPath + "\t# " + file.action),
          }
        : undefined;

function getDefinedSpecFields(spec: ChangeSpec): RawField[] {
    return concatIfOutputIsDefined(
        getChangeAsRawField,
        getDescriptionAsRawField,
        getFilesAsRawField,
    )(spec);
}

type CreatedChangelist = {
    rawOutput: string;
    chnum?: string;
};

function parseCreatedChangelist(createdStr: string): CreatedChangelist {
    // p4-node returns: '[{"raw":"Change 377 updated."}]'
    const raw = (JSON.parse(createdStr) as Array<{ raw: string }>)[0]?.raw;
    const matches = /Change\s(\d+)\s/.exec(raw);
    return {
        rawOutput: raw,
        chnum: matches?.[1],
    };
}

/**
 * Valid fields for a Perforce change spec.
 * Jobs and Files are indexed fields (Jobs0, Jobs1, Files0, Files1, etc.)
 */
const VALID_CHANGE_FIELDS = new Set([
    "Change",
    "Date",
    "Client",
    "User",
    "Status",
    "Type",
    "ImportedBy",
    "Identity",
    "Description",
    "JobStatus",
    "Jobs",
    "Stream",
    "Files",
]);

const INDEXED_FIELDS = new Set(["Jobs", "Files"]);

/**
 * Convert indexed fields (Files0, Files1, Jobs0, Jobs1) back to standard Perforce format.
 * Example: "Files0:\tfoo\n\nFiles1:\tbar" → "Files:\n\tfoo\n\tbar"
 * Also removes any fields not in the valid change spec field list.
 */
function convertIndexedFieldsToSpecFormat(input: string): string {
    const eol = input.includes("\r\n") ? "\r\n" : "\n";
    const lines = input.split(/\r?\n/);
    const result: string[] = [];

    // Collect indexed field values
    const indexedFields: Record<string, string[]> = {};
    const indexedPattern = /^(Jobs|Files)(\d+):\s*(.*)$/;

    for (const line of lines) {
        // Check for indexed field (Files0, Jobs0, etc.)
        const indexedMatch = indexedPattern.exec(line);
        if (indexedMatch) {
            const [, baseName, , value] = indexedMatch;
            (indexedFields[baseName] ??= []).push(value.trim());
            continue;
        }

        // Check for regular field line (FieldName: or FieldName:\t)
        const fieldMatch = /^([A-Za-z]+):/.exec(line);
        if (fieldMatch) {
            const fieldName = fieldMatch[1];
            if (VALID_CHANGE_FIELDS.has(fieldName) && !INDEXED_FIELDS.has(fieldName)) {
                result.push(line);
            }
            // Skip invalid fields silently
            continue;
        }

        // Keep continuation lines (start with tab) and blank lines
        if (line.startsWith("\t") || line.trim() === "") {
            result.push(line);
        }
        // Skip metadata lines (... extraTag0, etc.) and other invalid lines
    }

    // Insert collected indexed fields at the end
    for (const [baseName, values] of Object.entries(indexedFields)) {
        result.push(`${baseName}:`);
        for (const value of values) {
            result.push(`\t${value}`);
        }
        result.push("");
    }

    // Clean up extra blank lines
    return result.join(eol).replace(/(\r?\n){3,}/g, eol + eol);
}

// Raw change spec in string passed from editor and send to p4 change -i
// Called during spec save
const inputRawChangeCommand = makeSimpleCommand(
    "change",
    () => ["-i"],
    (options: { input: string }) => ({
        input: convertIndexedFieldsToSpecFormat(options.input),
    }),
);

// Called When createing new chagelist. Input is generated from ChangeSpec object
const inputChange = makeSimpleCommand(
    "change",
    () => ["-i"],
    (options: { spec: ChangeSpec }) => {
        const { spec } = options;
        // Merge rawFields with overrides, then format
        const fields = spec.rawFields
            .filter((f) => !spec[f.name.toLowerCase() as keyof ChangeSpec])
            .concat(getDefinedSpecFields(spec));

        const input = fields
            .map((f) => `${f.name}:\n\t${f.value.join("\n\t")}`)
            .join("\n\n");

        return { input };
    },
);

// Create Changelist from spec - p4 change -i
export const inputChangeSpec = asyncOuputHandler(inputChange, parseCreatedChangelist);
export const inputRawChangeSpec = asyncOuputHandler(
    inputRawChangeCommand,
    parseCreatedChangelist,
);

// Get Changelist spec - p4 change -o
export type ChangeSpecOptions = {
    existingChangelist?: string;
};

const changeFlags = flagMapper<ChangeSpecOptions>([], "existingChangelist", ["-o"], {
    lastArgIsFormattedArray: true,
});

// Map raw fields to ChangeSpec properties
function mapToChangeFields(rawFields: RawField[]): ChangeSpec {
    return {
        change: findFieldValue(rawFields, "Change")?.[0]?.trim(),
        description: findFieldValue(rawFields, "Description")?.join("\n"),
        files: findFieldValue(rawFields, "Files")?.map((file) => ({
            depotPath: file.trim(),
            action: "", // Action not provided by p4-node
        })),
        rawFields,
    };
}

// Status can be pending or submitted, p4 change -o will return 'new' update this.
function changeStatusToPending(rawFields: RawField[]): RawField[] {
    return rawFields.map((f) =>
        f.name === "Status" && f.value[0] === "new" ? { ...f, value: ["pending"] } : f,
    );
}

// Parses the output of 'p4 change -o <change>' into a ChangeSpec object
const parseOutputChangeSpec = pipe<string, RawField[], RawField[], ChangeSpec>(
    parseSpecString,
    changeStatusToPending,
    mapToChangeFields,
);

// p4-change -o
export const outputChange = makeSimpleCommand("change", changeFlags);
export const getChangeSpec = asyncOuputHandler(outputChange, parseOutputChangeSpec);
