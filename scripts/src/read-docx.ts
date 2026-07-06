import mammoth from "mammoth";

const result = await mammoth.extractRawText({ path: "../attached_assets/PTMT_Replit_Build_Prompt_1783333602166.docx" });
console.log(result.value);
