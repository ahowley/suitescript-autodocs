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
import { EntryPoints } from "N/types";
import serverWidget from "N/ui/serverWidget";

const ALREADY_COUNTED = new Set<string>();

type Dependency = {
  type: string;
  id: string;
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
    label: "ID",
    type: serverWidget.FieldType.TEXT,
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

function getScriptFileLines(script: record.Record): string[] {
  const scriptFileId = script.getValue("scriptfile") as number;
  const scriptFile = file.load(scriptFileId);
  return scriptFile
    .getContents()
    .split("\n")
    .map(line => line.trim().replace(/ +/g, " "));
}

function getDependenciesFromLine(line: string): Dependency[] {
  const lineCleaned = line.toLowerCase().replaceAll(" ", "").replaceAll("'", '"');
  const dependencies: Dependency[] = [];
  dependencies.push(
    ...(line.match(/customrecord[a-z0-9_]+/) ?? []).map(id => ({
      type: "Custom Record",
      id,
    })),
  );
  dependencies.push(
    ...(lineCleaned.match(/type.customrecord\+"[a-z0-9_]+(?=")/g) ?? []).map(id => ({
      type: "Custom Record",
      id: id.replace('type.customrecord+"', "customrecord"),
    })),
  );
  dependencies.push(
    ...(lineCleaned.match(/type.customrecord}[a-z0-9_]+(?=`)/g) ?? []).map(id => ({
      type: "Custom Record",
      id: id.replace("type.customrecord}", "customrecord"),
    })),
  );
  dependencies.push(
    ...(line.match(/customsearch[a-z0-9_]+/g) ?? []).map(id => ({
      type: "Saved Search",
      id,
    })),
  );
  dependencies.push(
    ...(line.match(/customlist[a-z0-9_]+/g) ?? []).map(id => ({
      type: "Custom List",
      id,
    })),
  );
  dependencies.push(
    ...(line.match(/custentity[a-z0-9_]+/g) ?? []).map(id => ({
      type: "Custom Entity Field",
      id,
    })),
  );
  dependencies.push(
    ...(line.match(/custitem[a-z0-9_]+/g) ?? []).map(id => ({
      type: "Custom Item Field",
      id,
    })),
  );
  dependencies.push(
    ...(line.match(/custevent[a-z0-9_]+/g) ?? []).map(id => ({
      type: "Custom CRM Field",
      id,
    })),
  );
  dependencies.push(
    ...(line.match(/custbody[a-z0-9_]+/g) ?? []).map(id => ({
      type: "Transaction Body Field",
      id,
    })),
  );
  dependencies.push(
    ...(line.match(/custcol[a-z0-9_]+/g) ?? []).map(id => ({
      type: "Transaction Line Field or Item Option",
      id,
    })),
  );
  dependencies.push(
    ...(line.match(/custitemnumber[a-z0-9_]+/g) ?? []).map(id => ({
      type: "Custom Item Number Field",
      id,
    })),
  );
  dependencies.push(
    ...(line.match(/custrecord[a-z0-9_]+/g) ?? []).map(id => ({
      type: "Other Record/Sublist Fields",
      id,
    })),
  );

  return dependencies;
}

function addScriptDependenciesToSublist(sublist: serverWidget.Sublist, script: record.Record) {
  const lines = getScriptFileLines(script);
  const dependencies = lines.flatMap(getDependenciesFromLine);

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
    ALREADY_COUNTED.add(dependency.id);
  }
}

export const beforeLoad: EntryPoints.UserEvent.beforeLoad = context => {
  const sublist = addDependenciesTabToForm(context);
  const scriptInternalIds = context.newRecord.getValue("custrecord_ng_associated_scripts") as number[];
  for (const id of scriptInternalIds) {
    const script = loadScriptByInternalId(id);
    addScriptDependenciesToSublist(sublist, script);
  }
};
