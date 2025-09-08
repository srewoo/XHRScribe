# Testing Model Selection Feature

## Test Steps

1. **Open Extension Settings**
   - Click on extension icon
   - Navigate to Settings tab

2. **Test Model Selection by Provider**

   ### OpenAI Provider
   - Select "OpenAI" as provider
   - Verify these models appear in dropdown:
     - GPT-4o (Most Capable)
     - GPT-4o Mini (Fast & Cheap) 
     - GPT-4 Turbo (Latest GPT-4 Turbo)
     - GPT-3.5 Turbo (Fast and cheap)

   ### Anthropic Provider  
   - Select "Anthropic" as provider
   - Verify these models appear:
     - Claude 3 Opus (Most capable)
     - Claude 3 Sonnet
     - Claude 3 Haiku (Fast and cheap)
     - Claude 3.5 Sonnet (Latest)

   ### Gemini Provider
   - Select "Google Gemini" as provider
   - Verify these models appear:
     - Gemini 1.5 Pro (2M context)
     - Gemini 1.5 Flash (Fast, efficient)
     - Gemini 1.5 Flash-8B (Smaller, faster)

   ### Local Provider
   - Select "Local LLM" as provider
   - Verify these models appear:
     - Llama 3.2 (Latest Llama)
     - CodeLlama 70B (Code-specific)
     - Mixtral 8x7B (MoE model)
     - DeepSeek Coder (Code-specific)

3. **Test Persistence**
   - Select a specific provider and model
   - Save settings
   - Close and reopen extension
   - Verify selected provider and model persist

4. **Test Auto-Model Update**
   - Select OpenAI provider with GPT-4o model
   - Change provider to Anthropic
   - Verify model auto-updates to first Anthropic model
   - Change back to OpenAI
   - Verify model updates to first OpenAI model

5. **Test Generation with Selected Model**
   - Upload a HAR file or record session
   - Select a specific model
   - Generate tests
   - Verify the selected model is used (check console logs)

## Expected Results
- ✅ Model dropdown updates based on provider
- ✅ Selected model persists across sessions
- ✅ Model auto-updates when provider changes
- ✅ Generation uses the selected model