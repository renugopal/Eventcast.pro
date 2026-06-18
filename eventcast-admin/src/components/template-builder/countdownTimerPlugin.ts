const STUDIO_DARK = {
  bgSurface: '#27272a',
  borderSubtle: '#27272a',
  border: '#3f3f46',
  text: '#fafafa',
  focus: '#6366f1',
} as const;

const EC_COUNTDOWN_BLOCK_MEDIA = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
  <circle cx="12" cy="12" r="9" stroke="#fbbf24" stroke-width="1.5"/>
  <path d="M12 7v5l3 2" stroke="#fafafa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="3" y="3" width="6" height="5" rx="1" stroke="#a1a1aa" stroke-width="1.2"/>
  <rect x="15" y="3" width="6" height="5" rx="1" stroke="#a1a1aa" stroke-width="1.2"/>
</svg>`;

const EC_COUNTDOWN_IFRAME_CSS = `
  .ec-countdown { display: inline-block; text-align: center; font-family: 'Cormorant Garamond', Georgia, serif; }
  .ec-countdown__grid { display: flex; align-items: flex-end; justify-content: center; gap: 0.35rem; flex-wrap: wrap; }
  .ec-countdown__unit { display: flex; flex-direction: column; align-items: center; min-width: 3.25rem; }
  .ec-countdown__num { display: block; font-size: 2.5rem; font-weight: 600; line-height: 1; letter-spacing: 0.04em; font-variant-numeric: tabular-nums; color: #fafafa; }
  .ec-countdown__label { display: block; margin-top: 0.35rem; font-size: 0.65rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(250,250,250,0.55); }
  .ec-countdown__sep { font-size: 1.75rem; font-weight: 300; line-height: 1; padding-bottom: 1.1rem; color: rgba(251,191,36,0.65); user-select: none; }
  .ec-countdown__live { padding: 0.75rem 1.25rem; }
  .ec-countdown__live-text { font-size: 1.5rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #fbbf24; }
`;

function defaultCountdownTargetDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  d.setHours(19, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ecCountdownUnit(unit: string, label: string) {
  return {
    tagName: 'div',
    classes: ['ec-countdown__unit'],
    droppable: false,
    selectable: true,
    hoverable: true,
    components: [
      { tagName: 'span', classes: ['ec-countdown__num'], attributes: { 'data-ec-unit': unit }, type: 'text', content: '00', droppable: false },
      { tagName: 'span', classes: ['ec-countdown__label'], type: 'text', content: label, droppable: false },
    ],
  };
}

export function countdownTimerPlugin(editorInst: any): { cleanup: () => void } {
  const D = STUDIO_DARK;
  const traitInputStyle = `width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;background:${D.bgSurface};border:1px solid ${D.borderSubtle};color:${D.text};font-size:12px;font-family:inherit;`;
  
  const bindTraitFocus = (input: HTMLElement) => {
    input.addEventListener('focus', () => { input.style.borderColor = D.focus; input.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.25)'; });
    input.addEventListener('blur', () => { input.style.borderColor = D.borderSubtle; input.style.boxShadow = 'none'; });
  };
  
  editorInst.TraitManager.addType('ec-datetime-local', {
    events: { change: 'onChange', input: 'onChange' },
    createInput() { const input = document.createElement('input'); input.type = 'datetime-local'; input.style.cssText = traitInputStyle; bindTraitFocus(input); return input; },
    onChange({ elInput, component, trait }: any) { const name = trait.get('name'); if (name) component.addAttributes({ [name]: elInput.value }); },
    onUpdate({ elInput, component, trait }: any) { const name = trait.get('name'); elInput.value = (name && component.getAttributes()?.[name]) || defaultCountdownTargetDate(); },
  });
  
  editorInst.TraitManager.addType('ec-text-trait', {
    events: { change: 'onChange', input: 'onChange' },
    createInput() { const input = document.createElement('input'); input.type = 'text'; input.style.cssText = traitInputStyle; bindTraitFocus(input); return input; },
    onChange({ elInput, component, trait }: any) { const name = trait.get('name'); if (name) component.addAttributes({ [name]: elInput.value }); },
    onUpdate({ elInput, component, trait }: any) { const name = trait.get('name'); elInput.value = (name && component.getAttributes()?.[name]) || ''; },
  });
  
  const injectCountdownCss = () => {
    try {
      const head = editorInst.Canvas.getBody()?.ownerDocument?.head;
      if (!head || head.querySelector('#ec-countdown-styles')) return;
      const style = document.createElement('style');
      style.id = 'ec-countdown-styles';
      style.textContent = EC_COUNTDOWN_IFRAME_CSS;
      head.appendChild(style);
    } catch { /* ignore */ }
  };
  
  editorInst.DomComponents.addType('ec-countdown', {
    isComponent: (el: HTMLElement) => el?.classList?.contains('ec-countdown') ? { type: 'ec-countdown' } : false,
    model: {
      defaults: {
        name: 'Countdown',
        tagName: 'div',
        classes: ['ec-countdown'],
        attributes: { 'data-target-date': defaultCountdownTargetDate(), 'data-live-message': "We're Live!" },
        droppable: false,
        traits: [
          { type: 'ec-datetime-local', name: 'data-target-date', label: 'Event Date & Time' },
          { type: 'ec-text-trait', name: 'data-live-message', label: 'Live Message' },
        ],
        'script-props': ['data-target-date', 'data-live-message'],
        script() {
          const el = this as HTMLElement;
          const prev = (el as any).__ecCountdownTimer as number | undefined;
          if (prev) clearInterval(prev);
          
          const readTarget = () => el.getAttribute('data-target-date') || '';
          const liveMessage = el.getAttribute('data-live-message') || "We're Live!";
          const grid = el.querySelector('.ec-countdown__grid') as HTMLElement | null;
          const liveWrap = el.querySelector('[data-ec-live]') as HTMLElement | null;
          const liveText = el.querySelector('.ec-countdown__live-text') as HTMLElement | null;
          
          const units = {
            days: el.querySelector('[data-ec-unit="days"]'),
            hours: el.querySelector('[data-ec-unit="hours"]'),
            minutes: el.querySelector('[data-ec-unit="minutes"]'),
            seconds: el.querySelector('[data-ec-unit="seconds"]'),
          };
          
          const pad = (n: number) => String(n).padStart(2, '0');
          
          const tick = () => {
            const targetMs = new Date(readTarget()).getTime();
            if (Number.isNaN(targetMs)) return;
            const diff = targetMs - Date.now();
            
            if (diff <= 0) {
              if (grid) grid.style.display = 'none';
              if (liveWrap) liveWrap.style.display = '';
              if (liveText) liveText.textContent = liveMessage;
              const t = (el as any).__ecCountdownTimer as number | undefined;
              if (t) clearInterval(t);
              return;
            }
            
            if (grid) grid.style.display = '';
            if (liveWrap) liveWrap.style.display = 'none';
            if (units.days) units.days.textContent = pad(Math.floor(diff / 86400000));
            if (units.hours) units.hours.textContent = pad(Math.floor((diff % 86400000) / 3600000));
            if (units.minutes) units.minutes.textContent = pad(Math.floor((diff % 3600000) / 60000));
            if (units.seconds) units.seconds.textContent = pad(Math.floor((diff % 60000) / 1000));
          };
          
          tick();
          (el as any).__ecCountdownTimer = window.setInterval(tick, 1000);
        },
        components: [
          {
            tagName: 'div', classes: ['ec-countdown__grid'], droppable: false, selectable: false,
            components: [
              ecCountdownUnit('days', 'Days'),
              { tagName: 'span', classes: ['ec-countdown__sep'], attributes: { 'aria-hidden': 'true' }, type: 'text', content: ':', droppable: false, selectable: false },
              ecCountdownUnit('hours', 'Hours'),
              { tagName: 'span', classes: ['ec-countdown__sep'], attributes: { 'aria-hidden': 'true' }, type: 'text', content: ':', droppable: false, selectable: false },
              ecCountdownUnit('minutes', 'Minutes'),
              { tagName: 'span', classes: ['ec-countdown__sep'], attributes: { 'aria-hidden': 'true' }, type: 'text', content: ':', droppable: false, selectable: false },
              ecCountdownUnit('seconds', 'Seconds'),
            ],
          },
          {
            tagName: 'div', classes: ['ec-countdown__live'], attributes: { 'data-ec-live': 'true' },
            droppable: false, selectable: false, style: { display: 'none' },
            components: [{ tagName: 'span', classes: ['ec-countdown__live-text'], type: 'text', content: "We're Live!", droppable: false }],
          },
        ],
      },
    },
  });
  
  editorInst.BlockManager.add('ec-countdown-block', {
    label: 'Countdown',
    category: { id: 'eventcast', label: '✦ Eventcast', open: true },
    media: EC_COUNTDOWN_BLOCK_MEDIA,
    content: { type: 'ec-countdown' },
  });
  
  editorInst.on('load', () => { injectCountdownCss(); setTimeout(injectCountdownCss, 800); });
  editorInst.on('component:add', (model: any) => { if (model.get('type') === 'ec-countdown') injectCountdownCss(); });
  
  return { cleanup() { editorInst.BlockManager.remove('ec-countdown-block'); } };
}
