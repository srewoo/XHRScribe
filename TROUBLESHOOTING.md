# XHRScribe Troubleshooting Guide

## Common Issues and Solutions

### 1. "Unchecked runtime.lastError: Could not establish connection" Error

**Problem**: You see this error in the Chrome console after installing the extension.

**Cause**: This occurs when the extension components (popup, content script, background) try to communicate before all parts are fully loaded.

**Solution**: 
The extension has been updated with proper error handling. To fix this issue:

1. **Reload the Extension**:
   - Go to `chrome://extensions/`
   - Find XHRScribe
   - Click the refresh icon
   - Close and reopen the extension popup

2. **Clear Chrome Extension Cache**:
   - Go to `chrome://extensions/`
   - Toggle Developer mode OFF then ON
   - Reload the extension

3. **Reinstall if Needed**:
   - Remove the extension
   - Load it again from the `dist` folder

### 2. Recording Not Starting

**Problem**: Clicking "Start Recording" doesn't work.

**Solutions**:

1. **Check DevTools Status**:
   - Close Chrome DevTools if open (extension uses debugger API)
   - Try recording again

2. **Check Permissions**:
   - Extension needs debugger permission
   - Accept any permission prompts

3. **Refresh the Page**:
   - Refresh the page you want to record
   - Open the extension popup
   - Try recording again

### 3. Extension Not Loading

**Problem**: Extension fails to load in Chrome.

**Solutions**:

1. **Check Chrome Version**:
   - Requires Chrome 116 or higher
   - Update Chrome if needed

2. **Check Build**:
   ```bash
   npm run build
   ```
   - Ensure no build errors
   - Load from `dist` folder, not project root

3. **Check Manifest**:
   - Verify `manifest.json` is in the dist folder
   - Check for JSON syntax errors

### 4. API Keys Not Working

**Problem**: Test generation fails with API errors.

**Solutions**:

1. **Verify API Keys**:
   - Open extension options/settings
   - Check API keys are entered correctly
   - No extra spaces or quotes

2. **Check API Limits**:
   - Verify your API account has credits
   - Check rate limits aren't exceeded

3. **Test API Keys**:
   ```bash
   # Test OpenAI
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer YOUR_KEY"
   
   # Test Claude
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: YOUR_KEY" \
     -H "anthropic-version: 2023-06-01"
   ```

### 5. HAR File Upload Issues

**Problem**: HAR file upload fails or doesn't generate tests.

**Solutions**:

1. **Check File Format**:
   - Must be valid JSON
   - Standard HAR format or exported from XHRScribe

2. **File Size**:
   - Large files (>10MB) may be slow
   - Try smaller HAR files first

3. **Validate HAR**:
   ```bash
   # Check if valid JSON
   cat your-file.har | python -m json.tool > /dev/null
   ```

### 6. Service Worker Stops

**Problem**: Extension stops working after being idle.

**Solutions**:

1. **Keep Active**:
   - Extension auto-pings to stay alive
   - Click extension icon periodically

2. **Check Background Errors**:
   - Go to `chrome://extensions/`
   - Click "service worker" link
   - Check console for errors

### 7. No Requests Captured

**Problem**: Recording shows no API requests.

**Solutions**:

1. **Check Filter Settings**:
   - Extension filters out static assets
   - Check if your API URLs match filters

2. **Refresh After Starting**:
   - Start recording
   - Refresh the page
   - Perform actions to trigger API calls

3. **Check Network Activity**:
   - Open DevTools Network tab first
   - Verify APIs are being called
   - Close DevTools then try recording

## Debug Mode

To enable debug logging:

1. Open the service worker console:
   - Go to `chrome://extensions/`
   - Find XHRScribe
   - Click "service worker"

2. Set debug flag:
   ```javascript
   localStorage.setItem('debug', 'true');
   ```

3. Check logs in:
   - Service worker console
   - Popup console (right-click popup → Inspect)
   - Page console (for content script logs)

## Getting Help

If issues persist:

1. **Check the Console**:
   - Service worker console
   - Popup console
   - Browser console

2. **Collect Information**:
   - Chrome version
   - Extension version
   - Error messages
   - Steps to reproduce

3. **Report Issues**:
   - Include console logs
   - Describe expected vs actual behavior
   - List any error messages

## Prevention Tips

1. **Always Reload After Changes**:
   - After updating files
   - After changing settings
   - After Chrome updates

2. **Keep Chrome Updated**:
   - Use Chrome 116+
   - Enable auto-updates

3. **Monitor API Usage**:
   - Check API quotas regularly
   - Use appropriate models for token limits

4. **Test in Incognito**:
   - Enable extension in incognito
   - Test without other extensions interfering

## Known Limitations

1. Cannot use with Chrome DevTools open on same tab
2. Content script injection may fail on some protected pages
3. Service worker may timeout after 5 minutes of inactivity
4. Large HAR files (1000+ requests) may cause performance issues