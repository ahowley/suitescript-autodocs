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
    exports.beforeSubmit = exports.beforeLoad = void 0;
    error_1 = __importDefault(error_1);
    file_1 = __importDefault(file_1);
    log_1 = __importDefault(log_1);
    record_1 = __importDefault(record_1);
    runtime_1 = __importDefault(runtime_1);
    search_1 = __importDefault(search_1);
    serverWidget_1 = __importDefault(serverWidget_1);
    const ALREADY_COUNTED = new Set();
    function accountId() {
        return runtime_1.default.accountId.toLowerCase().replace("_", "-");
    }
    function addDependenciesTabToForm(context, sublistIdSlug = "dependencies") {
        const form = context.form;
        form.addTab({
            id: `custpage_${sublistIdSlug}_tab`,
            label: (sublistIdSlug === "dependencies" ? "" : "Extra ") + "Dependencies",
        });
        const sublist = form.addSublist({
            id: `custpage_${sublistIdSlug}`,
            label: (sublistIdSlug === "dependencies" ? "" : "Extra ") + "Dependencies",
            tab: `custpage_${sublistIdSlug}_tab`,
            type: sublistIdSlug === "dependencies" ? serverWidget_1.default.SublistType.LIST : serverWidget_1.default.SublistType.INLINEEDITOR,
        });
        sublist.addField({
            id: "custpage_col_type",
            label: "Dependency Type",
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
    function storeExtraDependencyData(docsRecord) {
        const extraDependencyCount = docsRecord.getLineCount("custpage_extra_dependencies");
        const extraDependencyData = [];
        for (let extraDependencyLine = 0; extraDependencyLine < extraDependencyCount; extraDependencyLine++) {
            const type = docsRecord.getSublistValue({
                sublistId: "custpage_extra_dependencies",
                fieldId: "custpage_col_type",
                line: extraDependencyLine,
            });
            const id = docsRecord.getSublistValue({
                sublistId: "custpage_extra_dependencies",
                fieldId: "custpage_col_id",
                line: extraDependencyLine,
            });
            const name = (docsRecord.getSublistValue({
                sublistId: "custpage_extra_dependencies",
                fieldId: "custpage_col_name",
                line: extraDependencyLine,
            }) || undefined);
            const link = (docsRecord.getSublistValue({
                sublistId: "custpage_extra_dependencies",
                fieldId: "custpage_col_link",
                line: extraDependencyLine,
            }) || undefined);
            extraDependencyData.push({ type, id, name, link });
        }
        docsRecord.setValue({
            fieldId: "custrecord_ng_extra_dependency_data",
            value: JSON.stringify(extraDependencyData),
        });
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
            link = `https://${accountId}.app.netsuite.com/app/common/search/search.nl?cu=T&e=F&id=${internalId}`;
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
        const lineStripped = line.toLowerCase().replaceAll("'", '"').replaceAll(" ", "");
        return [
            ...(lineStripped.match(/customrecord[a-z0-9_]+(?=")/) ?? []).map(id => ({
                type: "Custom Record",
                id,
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
            })),
            ...(lineStripped.match(/type.customrecord\+"[a-z0-9_]+(?=")/g) ?? []).map(id => ({
                type: "Custom Record",
                id: id.replace('type.customrecord+"', "customrecord"),
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
            })),
            ...(lineStripped.match(/type.customrecord}[a-z0-9_]+(?=`)/g) ?? []).map(id => ({
                type: "Custom Record",
                id: id.replace("type.customrecord}", "customrecord"),
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
            })),
            ...(lineStripped.match(/customsearch[a-z0-9_]+(?=")/g) ?? []).map(id => getSavedSearchDependencyFromId(id, accountId())),
            ...(lineStripped.match(/customlist[a-z0-9_]+(?=")/g) ?? []).map(id => ({
                type: "Custom List",
                id,
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/custlists.nl?whence=`,
            })),
            ...(lineStripped.match(/custentity[a-z0-9_]+(?=")/g) ?? []).map(id => ({
                type: "Custom Entity Field",
                id,
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/entitycustfields.nl?whence=`,
            })),
            ...(lineStripped.match(/custitem[a-z0-9_]+(?=")/g) ?? []).map(id => ({
                type: "Custom Item Field",
                id,
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/itemcustfields.nl?whence=`,
            })),
            ...(lineStripped.match(/custevent[a-z0-9_]+(?=")/g) ?? []).map(id => ({
                type: "Custom CRM Field",
                id,
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/eventcustfields.nl?whence=`,
            })),
            ...(lineStripped.match(/custbody[a-z0-9_]+(?=")/g) ?? []).map(id => ({
                type: "Transaction Body Field",
                id,
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/bodycustfields.nl?whence=`,
            })),
            ...(lineStripped.match(/custcol[a-z0-9_]+(?=")/g) ?? []).map(id => ({
                type: "Transaction Line Field or Item Option",
                id,
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/columncustfields.nl?whence=`,
            })),
            ...(lineStripped.match(/custitemnumber[a-z0-9_]+(?=")/g) ?? []).map(id => ({
                type: "Custom Item Number Field",
                id,
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/itemnumbercustfields.nl?whence=`,
            })),
            ...(lineStripped.match(/custrecord[a-z0-9_]+(?=")/g) ?? []).map(id => ({
                type: "Other Record/Sublist Fields",
                id,
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/othercustfields.nl?whence=`,
            })),
        ];
    }
    function addScriptDependenciesToSublist(sublist, lines, customModules, extraDependencies) {
        const dependencies = lines.flatMap(getDependenciesFromLine);
        dependencies.push(...customModules);
        extraDependencies && dependencies.push(...extraDependencies);
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
    function loadExtraDependenciesIntoSublist(docsRecord, sublist) {
        const rawDependencyData = docsRecord.getValue("custrecord_ng_extra_dependency_data");
        const dependencies = JSON.parse(rawDependencyData || "[]");
        for (const dependency of dependencies) {
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
            sublist.setSublistValue({
                id: "custpage_col_name",
                value: dependency.name,
                line: index,
            });
            sublist.setSublistValue({
                id: "custpage_col_link",
                value: dependency.link,
                line: index,
            });
        }
    }
    function searchDeploymentsAsDependencies(scriptInternalId) {
        const deploymentSearch = search_1.default.create({
            type: "scriptdeployment",
            filters: [["script", "is", "4696"]],
            columns: [search_1.default.createColumn({ name: "recordtype", label: "Record Type" })],
        });
        const deploymentDependencies = [];
        deploymentSearch.run().each(function (result) {
            const recordTypeId = result.getValue("recordtype").toLowerCase();
            if (!recordTypeId.startsWith("customrecord"))
                return true;
            const recordTypeName = result.getText("recordtype");
            deploymentDependencies.push({
                type: "Custom Record",
                id: recordTypeId,
                name: recordTypeName,
                link: `https://${accountId()}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
            });
            return true;
        });
        return deploymentDependencies;
    }
    function getDirectScriptDependencies(script) {
        const scriptAsDependency = {
            type: script.type,
            id: script.getValue("scriptid"),
            name: script.getValue("name"),
            link: `https://${accountId()}.app.netsuite.com/app/common/scripting/script.nl?id=${script.getValue("id")}`,
        };
        const directDependencies = [scriptAsDependency];
        directDependencies.push(...searchDeploymentsAsDependencies(script.getValue("id")));
        return directDependencies;
    }
    function detectAndAddAllScriptDependencies(sublist, scriptFile, extraDependencies) {
        const scriptFolderPath = getScriptFileFolderPath(scriptFile);
        const lines = getScriptFileLines(scriptFile);
        const allRelativePathsInScript = getAllRelativePathsFromLines(scriptFolderPath, lines);
        const customModules = [];
        for (const path of allRelativePathsInScript) {
            try {
                const referencedFile = file_1.default.load(path.endsWith(".js") ? path : `${path}.js`);
                detectAndAddAllScriptDependencies(sublist, referencedFile);
                customModules.push({
                    type: "Custom SuiteScript Module",
                    id: referencedFile.path,
                    name: referencedFile.name,
                    link: `https://${accountId()}.app.netsuite.com/app/common/media/mediaitem.nl?id=${referencedFile.id}&e=F`,
                });
            }
            catch (_) {
                log_1.default.debug("Path does not contain a module, or failed to load:", path);
                continue;
            }
        }
        addScriptDependenciesToSublist(sublist, lines, customModules, extraDependencies);
    }
    const beforeLoad = context => {
        if ([context.UserEventType.EDIT, context.UserEventType.CREATE].includes(context.type)) {
            const extraDependenciesSublist = addDependenciesTabToForm(context, "extra_dependencies");
            if (context.type === context.UserEventType.EDIT) {
                loadExtraDependenciesIntoSublist(context.newRecord, extraDependenciesSublist);
            }
        }
        if (![context.UserEventType.EDIT, context.UserEventType.VIEW].includes(context.type)) {
            return;
        }
        const dependenciesSublist = addDependenciesTabToForm(context);
        const scriptInternalIds = context.newRecord.getValue("custrecord_ng_associated_scripts");
        for (const id of scriptInternalIds) {
            const script = loadScriptByInternalId(id);
            const scriptFile = getScriptFile(script);
            const extraDependencies = getDirectScriptDependencies(script);
            detectAndAddAllScriptDependencies(dependenciesSublist, scriptFile, extraDependencies);
        }
        loadExtraDependenciesIntoSublist(context.newRecord, dependenciesSublist);
    };
    exports.beforeLoad = beforeLoad;
    const beforeSubmit = context => {
        if (![context.UserEventType.EDIT, context.UserEventType.CREATE].includes(context.type)) {
            return;
        }
        storeExtraDependencyData(context.newRecord);
    };
    exports.beforeSubmit = beforeSubmit;
});
