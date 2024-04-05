/**
 * create-docs-ue.ts
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * Adds necessary sublist and tab to the SuiteScript Documentation record form before it loads, then parses associated
 * scripts and generates additional dependency information when loading an NG SuiteScript Documentation record.
 */

import error from "N/error";
import file from "N/file";
import log from "N/log";
import record from "N/record";
import runtime from "N/runtime";
import search from "N/search";
import { EntryPoints } from "N/types";
import dialog from "N/ui/dialog";
import serverWidget from "N/ui/serverWidget";

const ALREADY_COUNTED = new Set<string>();

type Dependency = {
  type: string;
  id: string;
  name?: string;
  link?: string;
};

function accountId() {
  return runtime.accountId.toLowerCase().replace("_", "-");
}

function addDependenciesTabToForm(context: EntryPoints.UserEvent.beforeLoadContext, sublistIdSlug = "dependencies") {
  const form = context.form;
  form.addTab({
    id: `custpage_${sublistIdSlug}_tab`,
    label: (sublistIdSlug === "dependencies" ? "" : "Extra ") + "Dependencies",
  });
  const sublist = form.addSublist({
    id: `custpage_${sublistIdSlug}`,
    label: (sublistIdSlug === "dependencies" ? "" : "Extra ") + "Dependencies",
    tab: `custpage_${sublistIdSlug}_tab`,
    type: sublistIdSlug === "dependencies" ? serverWidget.SublistType.LIST : serverWidget.SublistType.INLINEEDITOR,
  });
  sublist.addField({
    id: "custpage_col_type",
    label: "Dependency Type",
    type: serverWidget.FieldType.TEXT,
  });
  sublist.addField({
    id: "custpage_col_id",
    label: "ID or Path",
    type: serverWidget.FieldType.TEXT,
  });
  sublist.addField({
    id: "custpage_col_name",
    label: "Name",
    type: serverWidget.FieldType.TEXT,
  });
  sublist.addField({
    id: "custpage_col_link",
    label: "Link",
    type: serverWidget.FieldType.URL,
  });

  return sublist;
}

function storeExtraDependencyData(docsRecord: record.Record) {
  const extraDependencyCount = docsRecord.getLineCount("custpage_extra_dependencies");
  const extraDependencyData: Dependency[] = [];
  for (let extraDependencyLine = 0; extraDependencyLine < extraDependencyCount; extraDependencyLine++) {
    const type = docsRecord.getSublistValue({
      sublistId: "custpage_extra_dependencies",
      fieldId: "custpage_col_type",
      line: extraDependencyLine,
    }) as string;
    const id = docsRecord.getSublistValue({
      sublistId: "custpage_extra_dependencies",
      fieldId: "custpage_col_id",
      line: extraDependencyLine,
    }) as string;
    const name = (docsRecord.getSublistValue({
      sublistId: "custpage_extra_dependencies",
      fieldId: "custpage_col_name",
      line: extraDependencyLine,
    }) || undefined) as string;
    const link = (docsRecord.getSublistValue({
      sublistId: "custpage_extra_dependencies",
      fieldId: "custpage_col_link",
      line: extraDependencyLine,
    }) || undefined) as string;

    extraDependencyData.push({ type, id, name, link });
  }

  docsRecord.setValue({
    fieldId: "custrecord_ng_extra_dependency_data",
    value: JSON.stringify(extraDependencyData),
  });
}

function loadScriptByInternalId(id: number, typeIndex = 0): record.Record {
  const SCRIPT_TYPES = [
    record.Type.CLIENT_SCRIPT,
    record.Type.MAP_REDUCE_SCRIPT,
    record.Type.RESTLET,
    record.Type.SCHEDULED_SCRIPT,
    record.Type.SUITELET,
    record.Type.USEREVENT_SCRIPT,
    record.Type.WORKFLOW_ACTION_SCRIPT,
  ];
  if (typeIndex >= SCRIPT_TYPES.length) {
    const failedToLoadScriptError = error.create({
      name: "FAILED_TO_LOAD_SCRIPT",
      message: `Couldn't load script with internal id ${id}`,
    });
    log.error(failedToLoadScriptError.name, failedToLoadScriptError.message);
    throw failedToLoadScriptError;
  }
  try {
    return record.load({
      id,
      type: SCRIPT_TYPES[typeIndex],
    });
  } catch (_) {
    return loadScriptByInternalId(id, typeIndex + 1);
  }
}

function getScriptFile(script: record.Record): file.File {
  const scriptFileId = script.getValue("scriptfile") as number;
  return file.load(scriptFileId);
}

function getScriptFileFolderPath(scriptFile: file.File): string {
  const fullPath = scriptFile.path;
  return fullPath.replace(`/${scriptFile.name}`, "");
}

function getScriptFileLines(scriptFile: file.File): string[] {
  return scriptFile
    .getContents()
    .split("\n")
    .map(line => line.trim().replace(/ +/g, " "));
}

function getAllRelativePathsFromLines(basePath: string, lines: string[]): string[] {
  return lines.flatMap(line => {
    const lineStripped = line.replaceAll(" ", "").replaceAll("'", '"');
    const matches = lineStripped.match(/(?<=")\.+\/[\w\/\-]+(?=")/g) ?? ([] as string[]);
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

function getSavedSearchDependencyFromId(searchId: string, accountId: string): Dependency {
  const savedSearch = search.create({
    type: search.Type.SAVED_SEARCH,
    filters: [["id", "is", searchId]],
    columns: [
      search.createColumn({ name: "internalid", label: "Internal ID" }),
      search.createColumn({ name: "title", label: "Title" }),
    ],
  });
  let name: string;
  let link: string;
  savedSearch.run().each(result => {
    name = result.getValue("title") as string;
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

function getDependenciesFromLine(line: string): Dependency[] {
  const lineStripped = line.toLowerCase().replaceAll("'", '"').replaceAll(" ", "");
  return [
    ...(lineStripped.match(/customrecord[a-z0-9_]+(?=")/) ?? ([] as string[])).map(id => ({
      type: "Custom Record",
      id,
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
    })),
    ...(lineStripped.match(/type.customrecord\+"[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id => ({
      type: "Custom Record",
      id: id.replace('type.customrecord+"', "customrecord"),
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
    })),
    ...(lineStripped.match(/type.customrecord}[a-z0-9_]+(?=`)/g) ?? ([] as string[])).map(id => ({
      type: "Custom Record",
      id: id.replace("type.customrecord}", "customrecord"),
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
    })),
    ...(lineStripped.match(/customsearch[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id =>
      getSavedSearchDependencyFromId(id, accountId()),
    ),
    ...(lineStripped.match(/customlist[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id => ({
      type: "Custom List",
      id,
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/custlists.nl?whence=`,
    })),
    ...(lineStripped.match(/custentity[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id => ({
      type: "Custom Entity Field",
      id,
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/entitycustfields.nl?whence=`,
    })),
    ...(lineStripped.match(/custitem[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id => ({
      type: "Custom Item Field",
      id,
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/itemcustfields.nl?whence=`,
    })),
    ...(lineStripped.match(/custevent[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id => ({
      type: "Custom CRM Field",
      id,
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/eventcustfields.nl?whence=`,
    })),
    ...(lineStripped.match(/custbody[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id => ({
      type: "Transaction Body Field",
      id,
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/bodycustfields.nl?whence=`,
    })),
    ...(lineStripped.match(/custcol[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id => ({
      type: "Transaction Line Field or Item Option",
      id,
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/columncustfields.nl?whence=`,
    })),
    ...(lineStripped.match(/custitemnumber[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id => ({
      type: "Custom Item Number Field",
      id,
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/itemnumbercustfields.nl?whence=`,
    })),
    ...(lineStripped.match(/custrecord[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id => ({
      type: "Other Record/Sublist Fields",
      id,
      link: `https://${accountId()}.app.netsuite.com/app/common/custom/othercustfields.nl?whence=`,
    })),
  ];
}

function addScriptDependenciesToSublist(
  sublist: serverWidget.Sublist,
  lines: string[],
  customModules: Dependency[],
  extraDependencies?: Dependency[],
) {
  const dependencies = lines.flatMap(getDependenciesFromLine);
  dependencies.push(...customModules);
  extraDependencies && dependencies.push(...extraDependencies);

  for (const dependency of dependencies) {
    if (ALREADY_COUNTED.has(dependency.id)) continue;

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

function loadExtraDependenciesIntoSublist(docsRecord: record.Record, sublist: serverWidget.Sublist) {
  const rawDependencyData = docsRecord.getValue("custrecord_ng_extra_dependency_data") as string;
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

function searchDeploymentsAsDependencies(scriptInternalId: number): Dependency[] {
  const deploymentSearch = search.create({
    type: "scriptdeployment",
    filters: [["script", "is", "4696"]],
    columns: [search.createColumn({ name: "recordtype", label: "Record Type" })],
  });
  const deploymentDependencies: Dependency[] = [];
  deploymentSearch.run().each(function (result) {
    const recordTypeId = (result.getValue("recordtype") as string).toLowerCase();
    if (!recordTypeId.startsWith("customrecord")) return true;

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

function getDirectScriptDependencies(script: record.Record): Dependency[] {
  const scriptAsDependency: Dependency = {
    type: script.type as string,
    id: script.getValue("scriptid") as string,
    name: script.getValue("name") as string,
    link: `https://${accountId()}.app.netsuite.com/app/common/scripting/script.nl?id=${script.getValue("id")}`,
  };
  const directDependencies = [scriptAsDependency];
  directDependencies.push(...searchDeploymentsAsDependencies(script.getValue("id") as number));

  return directDependencies;
}

function detectAndAddAllScriptDependencies(
  sublist: serverWidget.Sublist,
  scriptFile: file.File,
  extraDependencies?: Dependency[],
) {
  const scriptFolderPath = getScriptFileFolderPath(scriptFile);
  const lines = getScriptFileLines(scriptFile);
  const allRelativePathsInScript = getAllRelativePathsFromLines(scriptFolderPath, lines);
  const customModules: Dependency[] = [];
  for (const path of allRelativePathsInScript) {
    try {
      const referencedFile = file.load(path.endsWith(".js") ? path : `${path}.js`);
      detectAndAddAllScriptDependencies(sublist, referencedFile);
      customModules.push({
        type: "Custom SuiteScript Module",
        id: referencedFile.path,
        name: referencedFile.name,
        link: `https://${accountId()}.app.netsuite.com/app/common/media/mediaitem.nl?id=${referencedFile.id}&e=F`,
      });
    } catch (_) {
      log.debug("Path does not contain a module, or failed to load:", path);
      continue;
    }
  }
  addScriptDependenciesToSublist(sublist, lines, customModules, extraDependencies);
}

export const beforeLoad: EntryPoints.UserEvent.beforeLoad = context => {
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
  const scriptInternalIds = context.newRecord.getValue("custrecord_ng_associated_scripts") as number[];
  for (const id of scriptInternalIds) {
    const script = loadScriptByInternalId(id);
    const scriptFile = getScriptFile(script);
    const extraDependencies = getDirectScriptDependencies(script);
    detectAndAddAllScriptDependencies(dependenciesSublist, scriptFile, extraDependencies);
  }

  loadExtraDependenciesIntoSublist(context.newRecord, dependenciesSublist);
};

export const beforeSubmit: EntryPoints.UserEvent.beforeSubmit = context => {
  if (![context.UserEventType.EDIT, context.UserEventType.CREATE].includes(context.type)) {
    return;
  }

  storeExtraDependencyData(context.newRecord);
};
