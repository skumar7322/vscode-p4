import { flagMapper, makeSimpleCommand, asyncOuputHandler } from "../CommandUtils";
import { isTruthy } from "../../TsUtils";

export interface ClientsOptions {
    nameFilter?: string;
    max?: number;
}

const clientsFlags = flagMapper<ClientsOptions>([
    ["E", "nameFilter"],
    ["m", "max"],
]);

const clientsCommand = makeSimpleCommand("clients", clientsFlags);

export type ClientInfo = {
    client: string;
    date: string;
    root: string;
    description: string;
};

function parseClientLine(clientObj: any): ClientInfo | undefined {
    if (!clientObj || typeof clientObj !== "object") {
        return undefined;
    }

    const client = clientObj.client;
    const dateStr = clientObj.Update;
    const date = dateStr ? new Date(parseInt(dateStr) * 1000).toString() : "";
    const root = clientObj.Root;
    const description = clientObj.Description;

    return {
        client,
        date,
        root,
        description,
    };
}

function parseClientsOutput(output: string) {
    const clients = JSON.parse(output);
    if (!Array.isArray(clients)) {
        return [];
    }
    return clients.map(parseClientLine).filter(isTruthy);
}

export const clients = asyncOuputHandler(clientsCommand, parseClientsOutput);
