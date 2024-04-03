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
define(["require", "exports", "N/error", "N/file", "N/log", "N/record", "N/ui/serverWidget"], function (require, exports, error_1, file_1, log_1, record_1, serverWidget_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.beforeLoad = void 0;
    error_1 = __importDefault(error_1);
    file_1 = __importDefault(file_1);
    log_1 = __importDefault(log_1);
    record_1 = __importDefault(record_1);
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
            label: "ID",
            type: serverWidget_1.default.FieldType.TEXT,
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
    function getScriptFileLines(script) {
        const scriptFileId = script.getValue("scriptfile");
        const scriptFile = file_1.default.load(scriptFileId);
        return scriptFile
            .getContents()
            .split("\n")
            .map(line => line.trim().replace(/ +/g, " "));
    }
    function getDependenciesFromLine(line) {
        const lineCleaned = line.toLowerCase().replaceAll(" ", "").replaceAll("'", '"');
        const dependencies = [];
        dependencies.push(...(line.match(/customrecord[a-z0-9_]+/) ?? []).map(id => ({
            type: "Custom Record",
            id,
        })));
        dependencies.push(...(lineCleaned.match(/type.customrecord\+"[a-z0-9_]+(?=")/g) ?? []).map(id => ({
            type: "Custom Record",
            id: id.replace('type.customrecord+"', "customrecord"),
        })));
        dependencies.push(...(lineCleaned.match(/type.customrecord}[a-z0-9_]+(?=`)/g) ?? []).map(id => ({
            type: "Custom Record",
            id: id.replace("type.customrecord}", "customrecord"),
        })));
        dependencies.push(...(line.match(/customsearch[a-z0-9_]+/g) ?? []).map(id => ({
            type: "Saved Search",
            id,
        })));
        dependencies.push(...(line.match(/customlist[a-z0-9_]+/g) ?? []).map(id => ({
            type: "Custom List",
            id,
        })));
        dependencies.push(...(line.match(/custentity[a-z0-9_]+/g) ?? []).map(id => ({
            type: "Custom Entity Field",
            id,
        })));
        dependencies.push(...(line.match(/custitem[a-z0-9_]+/g) ?? []).map(id => ({
            type: "Custom Item Field",
            id,
        })));
        dependencies.push(...(line.match(/custevent[a-z0-9_]+/g) ?? []).map(id => ({
            type: "Custom CRM Field",
            id,
        })));
        dependencies.push(...(line.match(/custbody[a-z0-9_]+/g) ?? []).map(id => ({
            type: "Transaction Body Field",
            id,
        })));
        dependencies.push(...(line.match(/custcol[a-z0-9_]+/g) ?? []).map(id => ({
            type: "Transaction Line Field or Item Option",
            id,
        })));
        dependencies.push(...(line.match(/custitemnumber[a-z0-9_]+/g) ?? []).map(id => ({
            type: "Custom Item Number Field",
            id,
        })));
        dependencies.push(...(line.match(/custrecord[a-z0-9_]+/g) ?? []).map(id => ({
            type: "Other Record/Sublist Fields",
            id,
        })));
        return dependencies;
    }
    function addScriptDependenciesToSublist(sublist, script) {
        const lines = getScriptFileLines(script);
        const dependencies = lines.flatMap(getDependenciesFromLine);
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
            ALREADY_COUNTED.add(dependency.id);
        }
    }
    const beforeLoad = context => {
        const sublist = addDependenciesTabToForm(context);
        const scriptInternalIds = context.newRecord.getValue("custrecord_ng_associated_scripts");
        for (const id of scriptInternalIds) {
            const script = loadScriptByInternalId(id);
            addScriptDependenciesToSublist(sublist, script);
        }
    };
    exports.beforeLoad = beforeLoad;
});
