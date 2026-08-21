import promptEn from '../prompts/prompt_en.md';
import promptZh from '../prompts/prompt_zh.md';
import trainEn from '../prompts/train_en.md';
import trainZh from '../prompts/train_zh.md';
import errorHintEn from '../prompts/error_hint_en.md';
import errorHintZh from '../prompts/error_hint_zh.md';
import initEn from '../prompts/init_en.md';
import initZh from '../prompts/init_zh.md';
import oversizeEn from '../prompts/oversize_en.md';
import oversizeZh from '../prompts/oversize_zh.md';
import chatgptPlatformPromptEn from '../prompts/platforms/chatgpt_en.md';
import chatgptPlatformPromptZh from '../prompts/platforms/chatgpt_zh.md';
import jsonProtocolPromptEn from '../prompts/protocols/json_en.md';
import jsonProtocolPromptZh from '../prompts/protocols/json_zh.md';
import xmlProtocolPromptEn from '../prompts/protocols/xml_en.md';
import xmlProtocolPromptZh from '../prompts/protocols/xml_zh.md';
import { BRANDING, PLATFORM_PROMPT_KEY_PREFIX, PROTOCOL } from '@webcode/shared';

function applyBranding(content: string): string {
  return content
    .replaceAll('{{PRODUCT_NAME}}', BRANDING.productName)
    .replaceAll('{{SLASH_COMMAND}}', BRANDING.slashCommand)
    .replaceAll('{{MENTION_COMMAND}}', BRANDING.mentionCommand)
    .replaceAll('{{INIT_TOOL_NAME}}', PROTOCOL.initToolName);
}

const PLATFORM_PROMPTS = {
  [`${PLATFORM_PROMPT_KEY_PREFIX}chatgpt_en`]: applyBranding(chatgptPlatformPromptEn),
  [`${PLATFORM_PROMPT_KEY_PREFIX}chatgpt_zh`]: applyBranding(chatgptPlatformPromptZh)
};

export const PROMPTS = {
  prompt_en: applyBranding(promptEn),
  prompt_zh: applyBranding(promptZh),
  train_en: applyBranding(trainEn),
  train_zh: applyBranding(trainZh),
  error_hint_en: applyBranding(errorHintEn),
  error_hint_zh: applyBranding(errorHintZh),
  init_en: applyBranding(initEn),
  init_zh: applyBranding(initZh),
  oversize_en: applyBranding(oversizeEn),
  oversize_zh: applyBranding(oversizeZh),
  protocol_json_en: applyBranding(jsonProtocolPromptEn),
  protocol_json_zh: applyBranding(jsonProtocolPromptZh),
  protocol_xml_en: applyBranding(xmlProtocolPromptEn),
  protocol_xml_zh: applyBranding(xmlProtocolPromptZh),
  ...PLATFORM_PROMPTS
};
