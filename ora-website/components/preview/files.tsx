import { OsWindow } from "./os-window";
import { Home as HomeIcon, ChevronRight } from "lucide-react";

/**
 * rumahl Files — rendered with the REAL file/folder icons from the
 * rumahl OS frontend (frontend/public/icons), same as the OS Files app.
 */
const sideItems = [
  { n: "Home", img: "/os/Home.png" },
  { n: "Documents", img: "/os/document_folder.png" },
  { n: "Images", img: "/os/images_folder.png" },
  { n: "Videos", img: "/os/video_folder.png" },
  { n: "NAS", img: "/os/nas.png" },
];

const files = [
  { n: "Documents", img: "/os/document_folder.png", s: "128 items" },
  { n: "Project_Photos.jpg", img: "/os/file_image.png", s: "4.2 MB" },
  { n: "Family_Movie.mkv", img: "/os/video_folder.png", s: "1.8 GB" },
  { n: "Backup_2026-08.zip", img: "/os/zip_folder.png", s: "12.4 GB" },
  { n: "Home_Inventory.xlsx", img: "/os/file_table.png", s: "84 KB" },
  { n: "Playlist_Summer", img: "/os/music_folder.png", s: "32 items" },
  { n: "Videos", img: "/os/video_folder.png", s: "9 items" },
  { n: "NAS_Manual.pdf", img: "/os/file_pdf.png", s: "2.1 MB" },
];

export function FilesPreview() {
  return (
    <OsWindow title="Files" status="/home/files">
      <div className="flex">
        {/* Sidebar */}
        <div className="hidden sm:block w-36 shrink-0 border-r border-border/60 bg-[hsl(var(--surface))] p-3">
          <p className="px-2 pb-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Favorites
          </p>
          {sideItems.map((s) => (
            <div
              key={s.n}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium ${
                s.n === "Documents"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <img src={s.img} alt="" className="h-4 w-4 object-contain" />
              {s.n}
            </div>
          ))}
          <p className="px-2 pb-2 pt-4 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Storage
          </p>
          <div className="px-2">
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-muted-foreground">NAS</span>
              <span className="font-mono text-foreground/70">1.2 / 4 TB</span>
            </div>
            <div className="h-1 rounded-full bg-border/70 overflow-hidden">
              <div className="h-full w-[30%] rounded-full bg-primary" />
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0 p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-4">
            <HomeIcon className="h-3 w-3" strokeWidth={1.8} />
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">Documents</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {files.map((f) => (
              <div
                key={f.n}
                className="flex flex-col gap-2 rounded-xl border border-border/60 p-3 hover:border-primary/40 transition-colors"
              >
                <img src={f.img} alt="" className="h-7 w-7 object-contain" />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-foreground truncate">{f.n}</p>
                  <p className="text-[9px] text-muted-foreground font-mono">{f.s}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </OsWindow>
  );
}
