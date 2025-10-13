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

export const getBasicField = (fields: RawField[], field: string) =>
    fields.find((i) => i.name === field)?.value;

const excludeNonFields = (parts: string[]) =>
    parts.filter((part) => !part.startsWith("#") && part !== "");

export const parseSpecOutput = pipe(splitIntoSections, excludeNonFields, parseRawFields);

export const parseSpecString = (input: string): RawField[] => {
    try {
        const fields: RawField[] = [];
        const json = JSON.parse(input);
        if (!Array.isArray(json)) {
            fields;
        }
        const firstObject = json[0];

        Object.entries(firstObject).forEach(([key, value]) => {
            const match = /^([A-Za-z]+)(\d+)$/.exec(key);
            if (match) {
                // Process Indexed field like Jobs0, Files1
                const baseName = match[1];
                let field = fields.find((f) => f.name === baseName);
                if (!field) {
                    field = { name: baseName, value: [String(value)] };
                    fields.push(field);
                } else {
                    field.value.push(String(value));
                }
            } else {
                fields.push({ name: key, value: [String(value)] });
            }
        });
        return fields;
    } catch {
        console.warn("SpecParser: Input is not valid JSON, parsing as text.");
        return [];
    }
};
