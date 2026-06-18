export function generateYoutubeSEO({
  groomName,
  brideName,
  eventType
}: {
  groomName: string;
  brideName?: string;
  eventType?: string;
}) {
  const isSinglePerson = !brideName || brideName.toLowerCase() === 'family';
  const mainName = isSinglePerson ? groomName : `${groomName} & ${brideName}`;
  const formattedEventType = eventType ? (eventType.charAt(0).toUpperCase() + eventType.slice(1)) : 'Event';
  
  // Dynamic SEO values from user's template
  const displayTitle = `${mainName} ${formattedEventType} Live | `;
  
  const groomTag = groomName.replace(/\s+/g, '');
  const brideTag = brideName ? brideName.replace(/\s+/g, '') : '';
  const eventTypeTag = formattedEventType.replace(/\s+/g, '');

  const displayDescription = `Welcome to the ${formattedEventType} Live of
**${mainName}** 💐

Join us live and be part of this beautiful ${formattedEventType.toLowerCase()} celebration filled with love and joy.

Bless the couple as they begin their new journey together.

Thank you for watching 🙏

#${groomTag} ${brideTag ? `#${brideTag} ` : ''}#${eventTypeTag}Live #Telugu${eventTypeTag}`;

  const tags = isSinglePerson 
    ? [
        `${groomName} ${formattedEventType.toLowerCase()}`,
        `${groomName} ${formattedEventType.toLowerCase()} live`,
        `Telugu ${formattedEventType.toLowerCase()} live`,
        `${formattedEventType.toLowerCase()} livestream India`,
        `Indian ${formattedEventType.toLowerCase()} live`,
        `South Indian ${formattedEventType.toLowerCase()} live`,
        `traditional Telugu ${formattedEventType.toLowerCase()}`,
        `${formattedEventType.toLowerCase()} ceremony live`
      ]
    : [
        `${groomName} ${brideName} ${formattedEventType.toLowerCase()}`,
        `${groomName} ${formattedEventType.toLowerCase()} live`,
        `${brideName} ${formattedEventType.toLowerCase()} live`,
        `Telugu ${formattedEventType.toLowerCase()} live`,
        `${formattedEventType.toLowerCase()} livestream India`,
        `Indian ${formattedEventType.toLowerCase()} live`,
        `South Indian ${formattedEventType.toLowerCase()} live`,
        `Telugu marriage live stream`,
        `traditional Telugu ${formattedEventType.toLowerCase()}`,
        `${formattedEventType.toLowerCase()} ceremony live`
      ];

  return {
    title: displayTitle,
    description: displayDescription,
    tags: tags.slice(0, 15)
  };
}
