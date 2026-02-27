import {
    removeLeadingNewline,
    splitIntoLines,
    removeIndent,
    splitIntoSections,
} from "./CommandUtils";
import { RawField } from "./CommonTypes";
import { pipe } from "@arrows/composition";

const parseRawField = pipe(removeLeadingNewline, splitIntoLines, removeIndent);

function parseRawFields(parts: string[]): RawField[] {
    return parts.map((field) => {
        const colPos = field.indexOf(":");
        const name = field.slice(0, colPos);
        const value = parseRawField(field.slice(colPos + 2));
        return { name, value };
    });
}

export const findFieldValue = (fields: RawField[], field: string) =>
    fields.find((i) => i.name === field)?.value;

const excludeNonFields = (parts: string[]) =>
    parts.filter((part) => !part.startsWith("#") && part !== "");

export const parseSpecOutput = pipe(splitIntoSections, excludeNonFields, parseRawFields);

// Parse p4-change -o output into RawField[]
export const parseSpecString = (input: string): RawField[] => {
    // Parse p4-node JSON format: [{"Change":"421","Description":"text\\n",...}]
    try {
        const fields: RawField[] = [];
        const json: unknown = JSON.parse(input);
        if (!Array.isArray(json) || json.length === 0) {
            return fields;
        }
        const specObject = json[0] as Record<string, unknown>;
        if (!specObject || typeof specObject !== "object") {
            return fields;
        }

        Object.entries(specObject).forEach(([key, value]) => {
            const strValue = String(value);

            // Only Description may contain literal \n that needs splitting
            const valueLines =
                key === "Description"
                    ? strValue
                          .replace(/\\n/g, "\n")
                          .split("\n")
                          .filter((line) => line.length > 0)
                    : [strValue.replace(/\\n$/, "")]; // Just trim trailing \n for other fields

            // Check if key is indexed fields like Jobs0, Files0, Files1
            const match = /^([A-Za-z]+)(\d+)$/.exec(key);
            if (match) {
                const baseName = match[1];
                let field = fields.find((f) => f.name === baseName);
                if (!field) {
                    field = { name: baseName, value: valueLines };
                    fields.push(field);
                } else {
                    field.value.push(...valueLines);
                }
            } else {
                fields.push({ name: key, value: valueLines });
            }
        });
        return fields;
    } catch {
        console.warn("SpecParser: Input is not valid JSON, parsing as text.");
        return [];
    }
};
