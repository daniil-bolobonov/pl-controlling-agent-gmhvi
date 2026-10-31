### Asset Types

Supported types:

- `domain-model-extension`: Domain model extensions that add custom fields to existing CAP entities. **This asset type contains `asset.yaml` and `extension.yaml` files.** The `asset.yaml` references the `extension.yaml` descriptor file via the `descriptorFile` property.
`domain-model-extension.json` includes entities, fields, types, translations, and appNamespace

### Workflow
While **Creating appropriate structure inside `assets/`** in point 4 of workflow
   - For `domain-model-extension` assets: create only `asset.yaml` - nothing else (deployment via `deploy_domain_model_extension` tool is optional and on-demand, after asset.yaml is generated)
- Refer to `domain-model-extension.json` and `domain-model-extension-descriptor` for the yaml schemas.



### Examples
#### Example 1: Domain Model Extension Asset
```yaml
apiVersion: asset.sap/v1
kind: Asset

metadata:
  name: bookshop-addresses-extension
  version: 1.0.0
  description: "Extends my.bookshop.Addresses entity with testField1"

type: domain-model-extension

sourceRoot: "."

provides:
  extensions:
    - descriptorFile: extension.yaml
      name: bookshop-addresses-extension
```

The domain model extension asset folder contains `asset.yaml` and `extension.yaml`:
```
assets/bookshop-addresses-extension/
├── asset.yaml          # as above
└── extension.yaml      # extension descriptor with entities, fields, translations
```

**extension.yaml** structure:
```yaml
# Opaque content for domain model extension asset
appNameSpace: sample-app
extensions:
  - extensionProject:
      name: BOOKSHOP-ADDRESSES-EXTENSION
      description: Extends my.bookshop.Addresses entity with testField1
      customAttributes: []
    types: []
    entities:
      - entityName: my.bookshop.Addresses
        displayName: Addresses
        isParametric: false
        fields:
          - fieldName: testField1
            isKey: false
            type:
              name: String
              isExtended: false
              isBase: true
            fieldLabel: Test Field1
    translations:
      - entityName: my.bookshop.Addresses
        locale: de
        translationKey: '{i18n>testField1}'
        translationValue: Testfeld 1
```

After the files are generated, the user can optionally deploy the extension via the `deploy_domain_model_extension` tool (deployment is on-demand only, requires explicit user approval).

### Gotchas
- Domain model extension assets contain `asset.yaml` and `extension.yaml` files; deployment via `deploy_domain_model_extension` tool is optional and on-demand (requires user approval after files are generated)
