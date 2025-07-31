import fs from "fs";
import YAML from "yaml";
import openDatabase from "websql";
import path from "node:path";
import semver from "semver";
import { merge } from "ts-deepmerge";
import icons from "./icon-families.json" with { type: "json" };
import customIcons from "./custom-icons.json" with { type: "json" };

const documentation = "Add icon from [Fontawesome 7 Free](https://fontawesome.com/search)";

const watch = process.argv.includes("--watch");
const dev = process.argv.includes("--dev");
let version = "0.0.0";
let counter = 0;
let globalStyles = [];
const iconValues = [];
const categoryValues = {};
const categoryIcons = {};
const styleValues = {};
const styleSelector = {};
const packValues = {
    brands: {
        name: "brands",
        label: "Brands",
        count: 0,
        styles: ["brands"],
    },
};
const yamlOptions = {
    collectionStyle: "block",
    indent: 2,
    lineWidth: 0,
};
const privatePath = "./Resources/Private";
const publicPath = "./Resources/Public";
buildIcons(!dev && !watch);

function buildIcons(writeIcons = true) {
    if (!fs.existsSync("./categories.yml")) {
        console.error(
            "\n  The categories.yml file is missing. Please add it to the root directory.\n",
        );
        process.exit(1);
    }

    const categories = YAML.parse(fs.readFileSync("./categories.yml", "utf8"));
    const databasePath = path.join(privatePath, "database.sqlite");

    console.log("\n  Processing Fontawesome categories...");
    for (const key in categories) {
        const item = categories[key];
        const replacedKey = key.replaceAll("-", "_");
        categoryValues[replacedKey] = {
            key: replacedKey,
            label: item.label,
            icons: item.icons,
        };

        item.icons.forEach((icon) => {
            if (!categoryIcons[icon]) {
                categoryIcons[icon] = [replacedKey];
                return;
            }
            if (!categoryIcons[icon].includes(replacedKey)) {
                categoryIcons[icon].push(replacedKey);
            }
        });
    }

    console.log("\n  Processing Fontawesome icons...");
    const collectedIcons = merge(customIcons, icons);
    for (const key in collectedIcons) {
        getValues(key, collectedIcons[key], writeIcons);
    }

    console.log("\n  Create Database...");
    const database = openDatabase(
        databasePath,
        "1.0",
        "Fontawesome Icons Database",
        1,
    );

    console.log("\n  Write to database...");
    database.transaction((txn) => {
        txn.executeSql(
            "CREATE VIRTUAL TABLE icons USING FTS5(name, label, keywords, styles, categories)",
        );
        iconValues.forEach((value) => {
            txn.executeSql(
                `INSERT INTO icons (name, label, keywords, styles, categories) VALUES(?, ?, ?, ?, ?)`,
                value,
            );
        });
        txn.executeSql("INSERT INTO icons (icons) VALUES ('optimize')");

        txn.executeSql(
            `CREATE TABLE categories(
                name TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                icons TEXT NOT NULL
            )`,
        );
        Object.values(categoryValues).forEach((value) => {
            value.icons = `_${value.icons.join("_,_")}_`;
            txn.executeSql(
                `INSERT INTO categories (name, label, icons) VALUES(?, ?, ?)`,
                Object.values(value),
            );
        });

        txn.executeSql(
            `CREATE TABLE styles(
                name TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                styles TEXT NOT NULL
            )`,
        );
        Object.values(styleValues).forEach((value) => {
            value.styles = `_${value.styles.join("_,_")}_`;
            txn.executeSql(
                `INSERT INTO styles (name, label, styles) VALUES(?, ?, ?)`,
                Object.values(value),
            );
        });

        txn.executeSql(
            `CREATE TABLE packs(
                name TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                count INTEGER NOT NULL,
                styles TEXT NOT NULL
            )`,
        );
        Object.values(packValues).forEach((value) => {
            value.styles = `_${value.styles.join("_,_")}_`;
            txn.executeSql(
                `INSERT INTO packs (name, label, count, styles) VALUES(?, ?, ?, ?)`,
                Object.values(value),
            );
        });

        txn.executeSql(
            `CREATE TABLE styleSelector(
                name TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                pack TEXT NOT NULL,
                style TEXT NOT NULL,
                selector TEXT NOT NULL
            )`,
        );
        Object.values(styleSelector).forEach((value) => {
            txn.executeSql(
                `INSERT INTO styleSelector (name, label, pack, style, selector) VALUES(?, ?, ?, ?, ?)`,
                Object.values(value),
            );
        });
    });

    console.log("\n  Write settings files...");
    const versionFile = YAML.stringify(
        {
            Neos: {
                Neos: {
                    Ui: {
                        frontendConfiguration: {
                            "Carbon.Fontawesome": {
                                version,
                            },
                        },
                    },
                },
            },
        },
        yamlOptions,
    );

    fs.writeFileSync("Configuration/Settings.Version.yaml", versionFile);
    const contentBox = YAML.stringify(
        {
            Neos: {
                Neos: {
                    Ui: {
                        frontendConfiguration: {
                            "Carbon.CodePen": {
                                afx: {
                                    fusionObjects: {
                                        Fontawesome: {
                                            documentation,
                                            snippet:
                                                '<Carbon.Fontawesome:Icon icon="${1|' +
                                                globalStyles.join(",") +
                                                '|}:${2}" />',
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        yamlOptions,
    );

    fs.writeFileSync("Configuration/Settings.ContentBox.yaml", contentBox);

    console.log(`\n  Processed ${counter} icons.`);
}

function getGlobalStyles(icons) {
    const styles = [];
    Object.values(icons).forEach((icon) => {
        const svgs = icon?.svgs || {};
        for (const family in svgs) {
            const prefix = family === "classic" ? "" : `${family}-`;
            for (const style in svgs[family]) {
                const key = `${prefix}${style}`;
                if (!styles.includes(key)) {
                    styles.push(key);
                }
            }
        }
    });

    return styles;
}

function getValues(name, obj, writeIcons) {
    const label = obj?.label || name;
    const terms = obj?.search?.terms || [];
    const aliases = obj?.aliases?.names || [];
    const category = categoryIcons[name] || [];
    const hideInSearch = obj?.hideInSearch || false;
    const versions = obj?.changes || [];
    const lastVersion = versions[versions.length - 1] || "0.0.0";
    if (semver.gt(lastVersion, version)) {
        version = lastVersion;
    }

    const keywords = [...new Set([...terms, ...aliases, ...category])].join(
        ",",
    );
    const svgs = obj?.svgs || {};

    const styleSelectors = [];

    for (const family in svgs) {
        const prefix = family === "classic" ? "" : `${family}-`;
        for (const style in svgs[family]) {
            let raw = svgs[family][style]?.raw || "";
            if (raw) {
                counter++;
                const key = `${prefix}${style}`;
                const selectorKey = styleKeyToSelector(key);

                if (writeIcons) {
                    const resolvedPath = path.join(publicPath, key);
                    if (!fs.existsSync(resolvedPath)) {
                        fs.mkdirSync(resolvedPath, { recursive: true });
                    }
                    raw = raw.replaceAll("fa-", "fa-icon-");
                    if (raw.includes(`<path opacity=".4"`)) {
                        raw = raw.replace(
                            `<path opacity=".4"`,
                            `<defs><style>.fa-icon-secondary{opacity:.4}</style></defs><path class="fa-icon-secondary"`,
                        );
                        raw = raw.replaceAll(
                            `<path opacity=".4"`,
                            `<path class="fa-icon-secondary"`,
                        );
                        raw = raw.replaceAll(
                            `<path fill="currentColor"`,
                            `<path class="fa-icon-primary" fill="currentColor"`,
                        );
                    }

                    fs.writeFileSync(
                        path.join(resolvedPath, `${name}.svg`),
                        raw,
                    );
                }

                if (hideInSearch) {
                    continue;
                }

                if (!styleSelectors.includes(selectorKey)) {
                    styleSelectors.push(selectorKey);
                }

                if (!globalStyles.includes(key)) {
                    globalStyles.push(key);
                }

                if (!styleSelector[key]) {
                    styleSelector[key] = {
                        name: key,
                        label: toTitleCase(key),
                        pack: family,
                        style: style,
                        selector: selectorKey,
                    };
                }

                if (style === "brands") {
                    packValues.brands.count++;
                } else {
                    if (!styleValues[style]) {
                        styleValues[style] = {
                            name: style,
                            label: toTitleCase(style),
                            styles: [key],
                        };
                    } else if (!styleValues[style].styles.includes(key)) {
                        styleValues[style].styles.push(key);
                    }

                    if (!packValues[family]) {
                        packValues[family] = {
                            name: family,
                            label: toTitleCase(family),
                            count: 1,
                            styles: [key],
                        };
                    } else {
                        packValues[family].count++;
                        if (!packValues[family].styles.includes(key)) {
                            packValues[family].styles.push(key);
                        }
                    }
                }
            }
        }
    }

    if (hideInSearch) {
        console.log(
            `\n  Skipping icon "${name}" because it is marked as hidden in search.`,
        );
        return;
    }

    const categorySelector = category.length
        ? `_${category.join("_,_")}_`
        : null;

    iconValues.push([
        name,
        label,
        keywords,
        styleSelectors.join(","),
        categorySelector,
    ]);
}

function toTitleCase(str) {
    return str
        .match(
            /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g,
        )
        .map((x) => x.slice(0, 1).toUpperCase() + x.slice(1))
        .join(" ");
}

function styleKeyToSelector(key) {
    return `_${key.replaceAll("-", "_")}_`;
}
