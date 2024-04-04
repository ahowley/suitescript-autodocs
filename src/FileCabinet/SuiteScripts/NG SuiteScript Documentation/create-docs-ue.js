/**
 * create-docs-ue.ts
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * Adds necessary sublist and tab to the SuiteScript Documentation record form before it loads, then parses associated
 * scripts and generates additional dependency information when loading an NG SuiteScript Documentation record.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
define(["require", "exports", "N/error", "N/file", "N/log", "N/record", "N/runtime", "N/search", "N/ui/serverWidget"], function (require, exports, error_1, file_1, log_1, record_1, runtime_1, search_1, serverWidget_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.beforeLoad = void 0;
    error_1 = __importDefault(error_1);
    file_1 = __importDefault(file_1);
    log_1 = __importDefault(log_1);
    record_1 = __importDefault(record_1);
    runtime_1 = __importDefault(runtime_1);
    search_1 = __importDefault(search_1);
    serverWidget_1 = __importDefault(serverWidget_1);
    const ALREADY_COUNTED = new Set();
    function addDependenciesTabToForm(context) {
        const form = context.form;
        form.addTab({
            id: "custpage_dependency_tab",
            label: "Dependencies",
        });
        const sublist = form.addSublist({
            id: "custpage_dependencies",
            label: "Dependencies",
            tab: "custpage_dependency_tab",
            type: serverWidget_1.default.SublistType.LIST,
        });
        sublist.addField({
            id: "custpage_col_type",
            label: "Type",
            type: serverWidget_1.default.FieldType.TEXT,
        });
        sublist.addField({
            id: "custpage_col_id",
            label: "ID or Path",
            type: serverWidget_1.default.FieldType.TEXT,
        });
        sublist.addField({
            id: "custpage_col_name",
            label: "Name",
            type: serverWidget_1.default.FieldType.TEXT,
        });
        sublist.addField({
            id: "custpage_col_link",
            label: "Link",
            type: serverWidget_1.default.FieldType.URL,
        });
        return sublist;
    }
    function loadScriptByInternalId(id, typeIndex = 0) {
        const SCRIPT_TYPES = [
            record_1.default.Type.CLIENT_SCRIPT,
            record_1.default.Type.MAP_REDUCE_SCRIPT,
            record_1.default.Type.RESTLET,
            record_1.default.Type.SCHEDULED_SCRIPT,
            record_1.default.Type.SUITELET,
            record_1.default.Type.USEREVENT_SCRIPT,
            record_1.default.Type.WORKFLOW_ACTION_SCRIPT,
        ];
        if (typeIndex >= SCRIPT_TYPES.length) {
            const failedToLoadScriptError = error_1.default.create({
                name: "FAILED_TO_LOAD_SCRIPT",
                message: `Couldn't load script with internal id ${id}`,
            });
            log_1.default.error(failedToLoadScriptError.name, failedToLoadScriptError.message);
            throw failedToLoadScriptError;
        }
        try {
            return record_1.default.load({
                id,
                type: SCRIPT_TYPES[typeIndex],
            });
        }
        catch (_) {
            return loadScriptByInternalId(id, typeIndex + 1);
        }
    }
    function getScriptFile(script) {
        const scriptFileId = script.getValue("scriptfile");
        return file_1.default.load(scriptFileId);
    }
    function getScriptFileFolderPath(scriptFile) {
        const fullPath = scriptFile.path;
        return fullPath.replace(`/${scriptFile.name}`, "");
    }
    function getScriptFileLines(scriptFile) {
        return scriptFile
            .getContents()
            .split("\n")
            .map(line => line.trim().replace(/ +/g, " "));
    }
    function getAllRelativePathsFromLines(basePath, lines) {
        return lines.flatMap(line => {
            const lineStripped = line.replaceAll(" ", "").replaceAll("'", '"');
            const matches = lineStripped.match(/(?<=")\.+\/[\w\/\-]+(?=")/g) ?? [];
            return matches.map(match => {
                const folderDepthToRemove = (basePath.match(/\.\.\//g) ?? []).length;
                if (folderDepthToRemove > 0) {
                    const foldersInBasePath = basePath.split("/");
                    const newBasePath = foldersInBasePath.slice(0, foldersInBasePath.length - folderDepthToRemove).join("/");
                    return `${newBasePath}/${match.replaceAll("../", "")}`;
                }
                return `${basePath}/${match.replace("./", "")}`;
            });
        });
    }
    function getSavedSearchDependencyFromId(searchId, accountId) {
        const savedSearch = search_1.default.create({
            type: search_1.default.Type.SAVED_SEARCH,
            filters: [["id", "is", searchId]],
            columns: [
                search_1.default.createColumn({ name: "internalid", label: "Internal ID" }),
                search_1.default.createColumn({ name: "title", label: "Title" }),
            ],
        });
        let name;
        let link;
        savedSearch.run().each(result => {
            name = result.getValue("title");
            const internalId = result.getValue("internalid").toString();
            link = `https://${accountId}.app.netsuite.com/app/common/search/search.nl?cu=T&e=T&id=${internalId}`;
            return false;
        });
        return {
            type: "Saved Search",
            id: searchId,
            name,
            link,
        };
    }
    function getDependenciesFromLine(line) {
        const lineLowered = line.toLowerCase();
        const lineStripped = lineLowered.replaceAll(" ", "").replaceAll("'", '"');
        const accountId = runtime_1.default.accountId.toLowerCase().replace("_", "-");
        const dependencies = [
            ...(lineLowered.match(/customrecord[a-z0-9_]+/) ?? []).map(id => ({
                type: "Custom Record",
                id,
                link: `https://${accountId}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
            })),
            ...(lineStripped.match(/type.customrecord\+"[a-z0-9_]+(?=")/g) ?? []).map(id => ({
                type: "Custom Record",
                id: id.replace('type.customrecord+"', "customrecord"),
            })),
            ...(lineStripped.match(/type.customrecord}[a-z0-9_]+(?=`)/g) ?? []).map(id => ({
                type: "Custom Record",
                id: id.replace("type.customrecord}", "customrecord"),
            })),
            ...(lineLowered.match(/customsearch[a-z0-9_]+/g) ?? []).map(id => getSavedSearchDependencyFromId(id, accountId)),
            ...(lineLowered.match(/customlist[a-z0-9_]+/g) ?? []).map(id => ({
                type: "Custom List",
                id,
            })),
            ...(lineLowered.match(/custentity[a-z0-9_]+/g) ?? []).map(id => ({
                type: "Custom Entity Field",
                id,
            })),
            ...(lineLowered.match(/custitem[a-z0-9_]+/g) ?? []).map(id => ({
                type: "Custom Item Field",
                id,
            })),
            ...(lineLowered.match(/custevent[a-z0-9_]+/g) ?? []).map(id => ({
                type: "Custom CRM Field",
                id,
            })),
            ...(lineLowered.match(/custbody[a-z0-9_]+/g) ?? []).map(id => ({
                type: "Transaction Body Field",
                id,
            })),
            ...(lineLowered.match(/custcol[a-z0-9_]+/g) ?? []).map(id => ({
                type: "Transaction Line Field or Item Option",
                id,
            })),
            ...(lineLowered.match(/custitemnumber[a-z0-9_]+/g) ?? []).map(id => ({
                type: "Custom Item Number Field",
                id,
            })),
            ...(lineLowered.match(/custrecord[a-z0-9_]+/g) ?? []).map(id => ({
                type: "Other Record/Sublist Fields",
                id,
            })),
        ];
        return dependencies;
    }
    function addScriptDependenciesToSublist(sublist, lines, customModules) {
        const dependencies = lines.flatMap(getDependenciesFromLine);
        dependencies.push(...customModules);
        for (const dependency of dependencies) {
            if (ALREADY_COUNTED.has(dependency.id))
                continue;
            const index = sublist.lineCount === -1 ? 0 : sublist.lineCount;
            sublist.setSublistValue({
                id: "custpage_col_type",
                value: dependency.type,
                line: index,
            });
            sublist.setSublistValue({
                id: "custpage_col_id",
                value: dependency.id,
                line: index,
            });
            dependency.name &&
                sublist.setSublistValue({
                    id: "custpage_col_name",
                    value: dependency.name,
                    line: index,
                });
            dependency.link &&
                sublist.setSublistValue({
                    id: "custpage_col_link",
                    value: dependency.link,
                    line: index,
                });
            ALREADY_COUNTED.add(dependency.id);
        }
    }
    function detectAndAddAllScriptDependencies(sublist, scriptFile) {
        const scriptFolderPath = getScriptFileFolderPath(scriptFile);
        const lines = getScriptFileLines(scriptFile);
        const allRelativePathsInScript = getAllRelativePathsFromLines(scriptFolderPath, lines);
        const customModules = [];
        const accountId = runtime_1.default.accountId.toLowerCase().replace("_", "-");
        for (const path of allRelativePathsInScript) {
            try {
                const referencedFile = file_1.default.load(path.endsWith(".js") ? path : `${path}.js`);
                detectAndAddAllScriptDependencies(sublist, referencedFile);
                customModules.push({
                    type: "Custom SuiteScript Module",
                    id: referencedFile.path,
                    name: referencedFile.name,
                    link: `https://${accountId}.app.netsuite.com/app/common/media/mediaitem.nl?id=${referencedFile.id}&e=F`,
                });
            }
            catch (_) {
                log_1.default.debug("Path does not contain a module, or failed to load:", path);
                continue;
            }
        }
        addScriptDependenciesToSublist(sublist, lines, customModules);
    }
    const beforeLoad = context => {
        const sublist = addDependenciesTabToForm(context);
        const scriptInternalIds = context.newRecord.getValue("custrecord_ng_associated_scripts");
        for (const id of scriptInternalIds) {
            const script = loadScriptByInternalId(id);
            const scriptFile = getScriptFile(script);
            detectAndAddAllScriptDependencies(sublist, scriptFile);
        }
    };
    exports.beforeLoad = beforeLoad;
});
