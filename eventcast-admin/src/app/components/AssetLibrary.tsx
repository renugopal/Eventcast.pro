import React, { useState } from "react";
import { Film, Play, Link, Folder, ChevronRight, ArrowLeft, Image as ImageIcon, CheckCircle2 } from "lucide-react";

interface AssetLibraryProps {
  assetLibrary: any[];
  getVideoThumbnail: (url: string) => string | null;
  setSelectedAsset: (url: string) => void;
}

export const AssetLibrary: React.FC<AssetLibraryProps> = ({
  assetLibrary,
  getVideoThumbnail,
  setSelectedAsset,
}) => {
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  function copyUrl(url: string, e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  }

  const activeFolder = activeFolderId
    ? assetLibrary.find((f) => f.eventId === activeFolderId)
    : null;

  return (
    <div className="w-full space-y-8 ec-animate-in">
      <div className="ec-section-header" style={{ marginBottom: 0 }}>
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--info-50)", color: "var(--info)", border: "2px solid #BFDBFE" }}
          >
            <Folder size={24} />
          </div>
          <div>
            <h2 className="ec-page-title" style={{ fontSize: "24px" }}>
              {activeFolder ? activeFolder.eventTitle : "Infrastructure Library"}
            </h2>
            <p className="ec-section-sub">
              {activeFolder
                ? `${activeFolder.assets.length} assets in this event`
                : `${assetLibrary.length} active event workspaces`}
            </p>
          </div>
        </div>
        {activeFolder && (
          <button
            type="button"
            onClick={() => setActiveFolderId(null)}
            className="ec-btn ec-btn-secondary"
          >
            <ArrowLeft size={18} />
            Back to workspace
          </button>
        )}
      </div>

      {!activeFolder ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {assetLibrary.map((folder) => (
            <button
              key={folder.eventId}
              type="button"
              onClick={() => setActiveFolderId(folder.eventId)}
              className="ec-card text-left group hover:-translate-y-0.5 transition-transform"
              style={{ padding: "24px 28px" }}
            >
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center mb-5 text-white"
                style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--violet-500) 100%)" }}
              >
                <Folder size={28} />
              </div>
              <h3
                className="font-bold text-lg leading-tight mb-4 line-clamp-2"
                style={{ color: "var(--foreground)" }}
              >
                {folder.eventTitle}
              </h3>
              <div
                className="flex items-center justify-between pt-4"
                style={{ borderTop: "1px solid var(--border-subtle)" }}
              >
                <span
                  className="ec-badge"
                  style={{
                    background: "var(--info-50)",
                    color: "var(--info)",
                    border: "1px solid #BFDBFE",
                  }}
                >
                  {folder.assets.length} files
                </span>
                <ChevronRight
                  size={20}
                  className="transition-transform group-hover:translate-x-0.5"
                  style={{ color: "var(--text-tertiary)" }}
                />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {activeFolder.assets.map((url: string, i: number) => {
            const isVideo =
              url.toLowerCase().endsWith(".mp4") ||
              url.toLowerCase().endsWith(".mov") ||
              url.includes("/video/upload/");
            const videoThumb = isVideo ? getVideoThumbnail(url) : null;

            return (
              <div
                key={i}
                className="aspect-square rounded-xl overflow-hidden border-2 cursor-zoom-in group relative transition-all hover:shadow-lg"
                style={{ borderColor: "var(--border)", background: "var(--surface-hover)" }}
                onClick={() => setSelectedAsset(url)}
              >
                {isVideo ? (
                  <div className="w-full h-full relative">
                    {videoThumb ? (
                      <img src={videoThumb} className="w-full h-full object-cover" alt="Video thumbnail" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2" style={{ color: "var(--primary)" }}>
                        <Film size={36} className="opacity-50" />
                        <span className="text-xs font-semibold">Video</span>
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/5 transition-colors">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center text-white bg-black/40 border border-white/30">
                        <Play size={20} fill="currentColor" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <img
                    src={url}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    alt="Asset"
                  />
                )}

                <div className="absolute inset-0 bg-[var(--foreground)]/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={(e) => copyUrl(url, e)}
                    className={`ec-btn ec-btn-sm ${copiedUrl === url ? "ec-btn-primary" : "ec-btn-secondary"}`}
                    style={{ color: copiedUrl === url ? "#fff" : undefined }}
                  >
                    {copiedUrl === url ? (
                      <>
                        <CheckCircle2 size={16} /> Copied
                      </>
                    ) : (
                      <>
                        <Link size={16} /> Copy URL
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {assetLibrary.length === 0 && (
        <div
          className="ec-card text-center"
          style={{ padding: "56px 32px", borderStyle: "dashed" }}
        >
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-6"
            style={{ background: "var(--surface-hover)", color: "var(--text-tertiary)" }}
          >
            <ImageIcon size={32} />
          </div>
          <h3 className="text-xl font-bold mb-2" style={{ color: "var(--foreground)" }}>
            No assets yet
          </h3>
          <p style={{ color: "var(--text-secondary)", maxWidth: "20rem", margin: "0 auto" }}>
            Create an event and upload media to populate your asset library.
          </p>
        </div>
      )}
    </div>
  );
};
