# SuiteScript Documentation

This project adds a custom record type to NetSuite that allows you to specify
multiple script records, a customization name, and a description. After saving,
viewing this custom record will reveal a sublist with an auto-generated map of
dependencies by searching for them in source code.

## Setup

- Install Dependencies

  ```bash
  npm i
  ```

- Install Recommended VS Code Extensions

  - Recommended extensions for code formatting are in .vscode/extensions.json.

- Setup SuiteCloud Development Framework

  - Install SuiteCloud CLI

    ```bash
    npm i @oracle/suitecloud-cli
    ```

    OR (to install globally)

    ```bash
    npm i -g @oracle/suitecloud-cli
    ```

  - Create access token (requires role with associated Access Token permissions)
    - Home > Settings Portlet > Manage Access Tokens > New My Access Token
    - Application Name: SuiteCloud Development Integration
    - Token Name: Any
  - Setup Account in CLI
    ```bash
    suitecloud account:setup -i
    ```

## Build & Deploy

- Compile
  ```bash
  npm run build
  ```
- Validate Project (with SuiteCloud CLI)
  ```bash
  npm run validate
  ```
- Deploy (with SuiteCloud CLI)
  ```bash
  npm run deploy
  ```
