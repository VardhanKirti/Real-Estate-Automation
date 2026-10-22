import { Camera, CircleHelp, Clapperboard, Download, FileText, Image as ImageIcon, Images, LayoutTemplate, Layers, Mic, Music, Scissors, Sparkles, Type, Upload, UserRound, Wand2 } from 'lucide-react';
import type { NodeType } from '@/lib/creative-engine/schemas';

/** One stroke icon per node type, shared by the node cards, the palette and the settings sheet. */
export const NODE_ICON: Record<NodeType, React.ReactNode> = {
  text: <Type className="h-3.5 w-3.5" strokeWidth={2.2} />, script: <FileText className="h-3.5 w-3.5" strokeWidth={2.2} />, media: <Upload className="h-3.5 w-3.5" strokeWidth={2.2} />, asset: <Images className="h-3.5 w-3.5" strokeWidth={2.2} />,
  llm: <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />, enhance: <Wand2 className="h-3.5 w-3.5" strokeWidth={2.2} />,
  video: <Clapperboard className="h-3.5 w-3.5" strokeWidth={2.2} />, image: <ImageIcon className="h-3.5 w-3.5" strokeWidth={2.2} />, talkingActor: <UserRound className="h-3.5 w-3.5" strokeWidth={2.2} />, veo31: <Clapperboard className="h-3.5 w-3.5" strokeWidth={2.2} />, videoEdit: <Scissors className="h-3.5 w-3.5" strokeWidth={2.2} />, broll: <Camera className="h-3.5 w-3.5" strokeWidth={2.2} />, scene: <Layers className="h-3.5 w-3.5" strokeWidth={2.2} />, music: <Music className="h-3.5 w-3.5" strokeWidth={2.2} />, audioDriven: <Mic className="h-3.5 w-3.5" strokeWidth={2.2} />, omnihuman: <UserRound className="h-3.5 w-3.5" strokeWidth={2.2} />, preset: <LayoutTemplate className="h-3.5 w-3.5" strokeWidth={2.2} />,
  deliver: <Download className="h-3.5 w-3.5" strokeWidth={2.2} />,
  missing: <CircleHelp className="h-3.5 w-3.5" strokeWidth={2.2} />,
};
