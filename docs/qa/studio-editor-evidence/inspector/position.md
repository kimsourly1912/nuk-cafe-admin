# Position inspector · Figma behavior reference

- Date: 2026-11-13
- Scope: the **Position** section of the selected element's Design inspector. Layout (W/H), Appearance, Fill and other sections are separate.
- Source: [Figma alignment, position and rotation help](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions), [Figma constraints help](https://help.figma.com/hc/en-us/articles/360039957734-Apply-constraints-to-define-how-layers-resize), and the live Position panel in the owner's Wireframe file.
- Status: Figma behavior verified; Studio behavior and product fit need comparison before an implementation decision.

The selected rectangle in the live file exposed six alignment buttons, X/Y steppers, a Constraints popup, a rotation stepper, **Rotate 90° right**, **Flip horizontal** and **Flip vertical**. Its current Constraints popup showed Center on both axes. This confirms that the nearby blue dotted lines describe the frame constraints, not drag-alignment feedback.

## 1. Align

The first row has exactly six actions:

| Horizontal | Vertical |
|---|---|
| Align left | Align top |
| Align horizontal centers | Align vertical centers |
| Align right | Align bottom |

- With **one layer**, align it to its parent group, frame or component container. With **multiple layers**, Figma aligns layers relative to one another or their parent context.
- **Shift-click** an alignment button aligns a multiple selection as a group to the parent frame; selections in different frames align to their respective parents.
- Figma's Windows shortcuts are Alt+A (left), Alt+H (horizontal center), Alt+D (right), Alt+W (top), Alt+V (vertical center), Alt+S (bottom). The Studio shortcut map may differ and must be checked before assigning them.
- These are explicit commands. They are distinct from the transient red smart guides that appear while dragging.
- Auto layout has different placement rules; do not copy the ordinary-frame alignment behavior into a flow layout without a separate check.

## 2. X and Y

- **X** moves the selected layer horizontally and **Y** vertically. The fields refer to the original upper-left corner of its bounds, even when the layer is rotated.
- Enter a number or an arithmetic expression: `+ 10`, `- 20`, `* 2`, `/ 4`, `^ 2` and parentheses are supported. For a mixed multi-selection, an equation can apply to each layer's current value rather than replacing all with one coordinate.
- Hover the field label and drag to scrub; on Windows, holding Alt over the field also enables scrubbing. Figma changes scrub speed according to vertical pointer position.
- Arrow keys nudge a selected layer by the configured small step (Figma default 1); Shift+arrow uses the big step (default 10). These are Figma point values, not fixed Studio units.
- Editing X/Y must update the canvas, selection bounds and any dependent inspector values consistently. Studio should decide its own origin, units and snapping based on the layout contract.

## 3. Frame constraints beside X/Y

The icon to the right of X/Y opens **Constraints**, a separate positioning rule for how a child responds when its parent frame resizes.

| Axis | Figma options |
|---|---|
| Horizontal | Left, Right, Left + Right, Center, Scale |
| Vertical | Top, Bottom, Top + Bottom, Center, Scale |

- Left/Top and Right/Bottom preserve the chosen edge gap. Opposite-edge pairs can resize the child as the parent changes. Center preserves the offset to the frame's center. Scale keeps proportional placement and size.
- Figma defaults to Left and Top for a newly placed layer. The live reference rectangle showed Center and Center.
- The **blue dotted horizontal and vertical lines** in the earlier frame screenshot visualize the selected layer's constraints. They do not represent Alt distances or drag alignment.
- Whether NUK Cafe Studio needs persistent frame-resize constraints is a product decision; first compare its fixed floor/layout model. The Figma reference alone does not authorize a new persistence rule.

## 4. Rotation and transforms

- The angle field begins at **0°**. Figma's Design panel uses positive angles for counterclockwise rotation and negative for clockwise rotation, normalized to the range -180° through 180°. The selection rotates around its center by default.
- The adjacent **Rotate 90° right** button is a clockwise quarter-turn. Its effect on a Figma angle follows from that sign convention.
- **Flip horizontal** mirrors left/right (Windows shortcut Shift+H); **Flip vertical** mirrors top/bottom (Shift+V). They are distinct transforms, not merely a change of rotation angle.
- On the canvas, hover just outside a corner and drag to rotate. Hold Shift to snap in 15° increments. Windows Alt+R exposes the rotation-origin target, which can be moved.
- The rotation field accepts arithmetic expressions and scrubbing. Figma notes that effects do not rotate with a layer.
- A circular fill may look unchanged under rotation, but its arc opening, asymmetric content, selection box or attached orientation may reveal the transform.

## Studio comparison checklist

1. Inspect a single item inside a floor/frame, then several items. Test all six alignment commands and their reference bounds; verify undo, save and reload.
2. Edit X, Y and angle by typing, stepping and scrubbing. Check canvas feedback, zoom independence, negative coordinates, rotated objects, and changed values after reselecting.
3. Test Rotate 90° right and both flips on an asymmetric asset or arc. Confirm the angle/orientation, not just a symmetric circle.
4. Compare the current Studio frame behavior before designing Constraints. If supported, resize the parent and check all horizontal/vertical modes.
5. Verify that keyboard shortcuts do not conflict with Studio's existing Move, draw, tool, and browser shortcuts. Avoid changing layout ownership or table QR identity merely to match Figma.

## Boundaries

This is a Figma reference, not a claim that Studio already implements the controls. Figma's pixel/point values, auto layout, movable rotation origin and frame-resize constraints need explicit mapping to Studio's geometry, units and save contract before implementation.
