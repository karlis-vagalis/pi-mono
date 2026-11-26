// Reference pages checked during curation:
// https://en.wikipedia.org/wiki/List_of_art_movements
// https://en.wikipedia.org/wiki/List_of_architectural_styles
// https://en.wikipedia.org/wiki/Printmaking
// https://aesthetics.fandom.com/wiki/List_of_Aesthetics
// https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
// Values are curated static prompts, not a runtime scrape.
import animationStyles from "./animation-styles.ts";
import architecture from "./architecture.ts";
import artMovements from "./art-movements.ts";
import artisticTechniques from "./artistic-techniques.ts";
import atmospheres from "./atmospheres.ts";
import colorStyles from "./color-styles.ts";
import culturalInfluences from "./cultural-influences.ts";
import fashionAesthetics from "./fashion-aesthetics.ts";
import graphicDesignStyles from "./graphic-design-styles.ts";
import historicalEras from "./historical-eras.ts";
import illustrationStyles from "./illustration-styles.ts";
import internetAesthetics from "./internet-aesthetics.ts";
import layoutStyles from "./layout-styles.ts";
import materials from "./materials.ts";
import objectsMetaphors from "./objects-metaphors.ts";
import photographyStyles from "./photography-styles.ts";
import subcultures from "./subcultures.ts";
import textures from "./textures.ts";
import typographyStyles from "./typography-styles.ts";
import uiStyles from "./ui-styles.ts";

export const STYLE_DIMENSIONS = {
	"Art movements": artMovements,
	"Graphic design styles": graphicDesignStyles,
	"Internet aesthetics": internetAesthetics,
	"UI styles": uiStyles,
	Architecture: architecture,
	"Historical eras": historicalEras,
	"Fashion aesthetics": fashionAesthetics,
	"Typography styles": typographyStyles,
	"Color styles": colorStyles,
	"Layout styles": layoutStyles,
	Textures: textures,
	"Illustration styles": illustrationStyles,
	"Photography styles": photographyStyles,
	"Animation styles": animationStyles,
	"Cultural influences": culturalInfluences,
	Atmospheres: atmospheres,
	"Objects / metaphors": objectsMetaphors,
	Materials: materials,
	"Artistic techniques": artisticTechniques,
	Subcultures: subcultures,
} as const;

export type StyleCategory = keyof typeof STYLE_DIMENSIONS;
export const STYLE_CATEGORIES = Object.keys(
	STYLE_DIMENSIONS,
) as StyleCategory[];
