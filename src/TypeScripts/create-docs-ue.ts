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
import serverWidget from "N/ui/serverWidget";

const ALREADY_COUNTED = new Set<string>();

type Dependency = {
  type: string;
  id: string;
  name?: string;
  link?: string;
};

function addDependenciesTabToForm(context: EntryPoints.UserEvent.beforeLoadContext) {
  const form = context.form;
  form.addTab({
    id: "custpage_dependency_tab",
    label: "Dependencies",
  });
  const sublist = form.addSublist({
    id: "custpage_dependencies",
    label: "Dependencies",
    tab: "custpage_dependency_tab",
    type: serverWidget.SublistType.LIST,
  });
  sublist.addField({
    id: "custpage_col_type",
    label: "Type",
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
  const lineLowered = line.toLowerCase();
  const lineStripped = lineLowered.replaceAll(" ", "").replaceAll("'", '"');
  const accountId = runtime.accountId.toLowerCase().replace("_", "-");
  const dependencies: Dependency[] = [
    ...(lineLowered.match(/customrecord[a-z0-9_]+/) ?? ([] as string[])).map(id => ({
      type: "Custom Record",
      id,
      link: `https://${accountId}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
    })),
    ...(lineStripped.match(/type.customrecord\+"[a-z0-9_]+(?=")/g) ?? ([] as string[])).map(id => ({
      type: "Custom Record",
      id: id.replace('type.customrecord+"', "customrecord"),
      link: `https://${accountId}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
    })),
    ...(lineStripped.match(/type.customrecord}[a-z0-9_]+(?=`)/g) ?? ([] as string[])).map(id => ({
      type: "Custom Record",
      id: id.replace("type.customrecord}", "customrecord"),
      link: `https://${accountId}.app.netsuite.com/app/common/custom/custrecords.nl?whence=`,
    })),
    ...(lineLowered.match(/customsearch[a-z0-9_]+/g) ?? ([] as string[])).map(id =>
      getSavedSearchDependencyFromId(id, accountId),
    ),
    ...(lineLowered.match(/customlist[a-z0-9_]+/g) ?? ([] as string[])).map(id => ({
      type: "Custom List",
      id,
      link: `https://${accountId}.app.netsuite.com/app/common/custom/custlists.nl?whence=`,
    })),
    ...(lineLowered.match(/custentity[a-z0-9_]+/g) ?? ([] as string[])).map(id => ({
      type: "Custom Entity Field",
      id,
      link: `https://${accountId}.app.netsuite.com/app/common/custom/entitycustfields.nl?whence=`,
    })),
    ...(lineLowered.match(/custitem[a-z0-9_]+/g) ?? ([] as string[])).map(id => ({
      type: "Custom Item Field",
      id,
      link: `https://${accountId}.app.netsuite.com/app/common/custom/itemcustfields.nl?whence=`,
    })),
    ...(lineLowered.match(/custevent[a-z0-9_]+/g) ?? ([] as string[])).map(id => ({
      type: "Custom CRM Field",
      id,
      link: `https://${accountId}.app.netsuite.com/app/common/custom/eventcustfields.nl?whence=`,
    })),
    ...(lineLowered.match(/custbody[a-z0-9_]+/g) ?? ([] as string[])).map(id => ({
      type: "Transaction Body Field",
      id,
      link: `https://${accountId}.app.netsuite.com/app/common/custom/bodycustfields.nl?whence=`,
    })),
    ...(lineLowered.match(/custcol[a-z0-9_]+/g) ?? ([] as string[])).map(id => ({
      type: "Transaction Line Field or Item Option",
      id,
      link: `https://${accountId}.app.netsuite.com/app/common/custom/columncustfields.nl?whence=`,
    })),
    ...(lineLowered.match(/custitemnumber[a-z0-9_]+/g) ?? ([] as string[])).map(id => ({
      type: "Custom Item Number Field",
      link: `https://${accountId}.app.netsuite.com/app/common/custom/itemnumbercustfields.nl?whence=`,
      id,
    })),
    ...(lineLowered.match(/custrecord[a-z0-9_]+/g) ?? ([] as string[])).map(id => ({
      type: "Other Record/Sublist Fields",
      id,
      link: `https://${accountId}.app.netsuite.com/app/common/custom/othercustfields.nl?whence=`,
    })),
  ];

  return dependencies;
}

function addScriptDependenciesToSublist(sublist: serverWidget.Sublist, lines: string[], customModules: Dependency[]) {
  const dependencies = lines.flatMap(getDependenciesFromLine);
  dependencies.push(...customModules);

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

function detectAndAddAllScriptDependencies(sublist: serverWidget.Sublist, scriptFile: file.File) {
  const scriptFolderPath = getScriptFileFolderPath(scriptFile);
  const lines = getScriptFileLines(scriptFile);
  const allRelativePathsInScript = getAllRelativePathsFromLines(scriptFolderPath, lines);
  const customModules: Dependency[] = [];
  const accountId = runtime.accountId.toLowerCase().replace("_", "-");
  for (const path of allRelativePathsInScript) {
    try {
      const referencedFile = file.load(path.endsWith(".js") ? path : `${path}.js`);
      detectAndAddAllScriptDependencies(sublist, referencedFile);
      customModules.push({
        type: "Custom SuiteScript Module",
        id: referencedFile.path,
        name: referencedFile.name,
        link: `https://${accountId}.app.netsuite.com/app/common/media/mediaitem.nl?id=${referencedFile.id}&e=F`,
      });
    } catch (_) {
      log.debug("Path does not contain a module, or failed to load:", path);
      continue;
    }
  }
  addScriptDependenciesToSublist(sublist, lines, customModules);
}

export const beforeLoad: EntryPoints.UserEvent.beforeLoad = context => {
  const sublist = addDependenciesTabToForm(context);
  const scriptInternalIds = context.newRecord.getValue("custrecord_ng_associated_scripts") as number[];
  for (const id of scriptInternalIds) {
    const script = loadScriptByInternalId(id);
    const scriptFile = getScriptFile(script);
    detectAndAddAllScriptDependencies(sublist, scriptFile);
  }
};
