### Workflow
**Create appropriate structure inside `assets/`**:
   - Use single-container for simple apps
   - Use multi-component for AppRouter patterns

### Best Practices

1. **Use environment variables** for configuration (cap-app asset only):
   ```yaml
   env:
     PORT: "3000"
     LOG_LEVEL: info
   ```

2. **For AppRouter assets**, NEVER include destinations in xs-app.json - use env var instead

3. **Standard ports**:
  - Node.js: 3000
  - Java: 8080
  - AppRouter: 5000

### Common Issues

**AppRouter Fails with "unknown destination backend"**
- ✅ Remove `destinations` block from xs-app.json
- ✅ Add `destinations` environment variable in asset.yaml

**Service exposes wrong port**
- ✅ Ensure AppRouter is first component in list
