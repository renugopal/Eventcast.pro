
const fs = require('fs');
const logFile = 'C:/Users/Renugopal/.gemini/antigravity/brain/ca9b1957-cfc7-42b5-82ee-d39ead7411cf/.system_generated/logs/transcript.jsonl';
const lines = fs.readFileSync(logFile, 'utf-8').split('\n');

for (let line of lines) {
  if (!line.trim()) continue;
  try {
    const d = JSON.parse(line);
    if (d.type === 'TOOL_RESPONSE' && d.tool_responses) {
      for(let tr of d.tool_responses){
        if(tr.name === 'view_file' && tr.response && tr.response.output && tr.response.output.includes('GrapesEditor.tsx')){
           const output = tr.response.output;
           const regex = /^(\d+):\s(.*)$/gm;
           let match;
           let found = 0;
           while ((match = regex.exec(output)) !== null) {
             found++;
           }
           console.log('Found view_file output with', found, 'lines');
        }
      }
    }
  } catch (e) {}
}

