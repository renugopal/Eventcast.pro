import { BuilderWrapper } from '@/components/template-builder/BuilderWrapper';

export default function TemplateBuilderPage() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#18181b]">
      <main className="flex-1 overflow-hidden">
        <BuilderWrapper />
      </main>
    </div>
  );
}
