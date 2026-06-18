import json
import re

log_file = r'C:\Users\Renugopal\.gemini\antigravity\brain\ca9b1957-cfc7-42b5-82ee-d39ead7411cf\.system_generated\logs\transcript.jsonl'
output_file = r'd:\Eventcast.pro\eventcast-admin\recovered_editor.txt'

lines_dict = {}

with open(log_file, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            d = json.loads(line)
        except:
            continue
        
        if d.get('source') == 'SYSTEM' and 'GrapesEditor.tsx' in d.get('content', ''):
            content = d['content']
            # Parse lines like "305:       // --- Fix Responsive Viewport Bug"
            matches = re.findall(r'^(\d+):\s(.*)$', content, re.MULTILINE)
            for num_str, line_content in matches:
                lines_dict[int(num_str)] = line_content

with open(output_file, 'w', encoding='utf-8') as out:
    for i in range(1, max(lines_dict.keys()) + 1 if lines_dict else 1):
        out.write(lines_dict.get(i, f'// MISSING LINE {i}') + '\n')
print(f'Recovered {len(lines_dict)} lines')
