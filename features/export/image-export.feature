# Domain: export
# Source: client/src/exportImage.js (exportToPng, exportToSvg, copyToClipboard, generateInteractiveHtml)

Feature: Image and interactive HTML export
  As a user I want to export my thinking tree as an image or interactive HTML so that I can share visual snapshots

  Background:
    Given I am logged in
    And I have an active session in "idea" mode
    And I have a generated tree rendered on the ReactFlow canvas

  # --- PNG export ---
  Scenario: Export tree as a high-resolution PNG
    Given my tree has 12 nodes across 3 depth levels
    When I trigger PNG export
    Then the ReactFlow viewport element is captured using html-to-image toPng
    And the image is rendered at 2x scale by default
    And the viewport transform is computed via getViewportForBounds to fit all nodes
    And ReactFlow chrome (controls, minimap, panels, background) is filtered out
    And the image has background color "#0a0a0f"
    And a file download is triggered with the PNG data URL

  # --- SVG export ---
  Scenario: Export tree as an SVG
    Given my tree has 8 nodes
    When I trigger SVG export
    Then the ReactFlow viewport is captured using html-to-image toSvg
    And the SVG string is wrapped in a Blob with type "image/svg+xml"
    And a file download is triggered via a temporary object URL
    And the object URL is revoked after 5 seconds

  # --- Copy to clipboard ---
  Scenario: Copy tree image to clipboard for pasting
    Given my tree has nodes of types "seed", "feature", "risk"
    When I trigger copy to clipboard
    Then the tree is captured as a PNG blob using html-to-image toBlob
    And the blob is written to the system clipboard as a ClipboardItem with type "image/png"
    And I can paste the image into external applications like Slack or Google Docs

  # --- Interactive HTML export ---
  Scenario: Export tree as a self-contained interactive HTML file
    Given my tree is about "AI writing assistant"
    And the tree has 15 nodes with types, labels, reasoning, scores, and parent relationships
    When I trigger interactive HTML export
    Then a single HTML file is generated containing all node data as embedded JSON
    And the HTML includes a dark theme with background "#0a0a0f" and monospace font
    And each node is rendered with its type-specific color, icon, and label from nodeConfig
    And nodes with scores display a color-coded score badge (green >= 8, yellow >= 5, red < 5)
    And nodes are laid out in a top-down tree with 340px horizontal spacing and 200px vertical spacing
    And SVG bezier curve edges connect parent nodes to children
    And the HTML supports mouse drag to pan and scroll wheel to zoom
    And a file download is triggered with the HTML content

  # --- Interactive HTML: node details ---
  Scenario: Interactive HTML preserves full node information
    Given my tree has a node with type "feature", label "Real-time collaboration", reasoning "Enable multiple users to edit simultaneously", and score 9
    When I generate the interactive HTML
    Then the node element displays the type icon and uppercase type label in the node's accent color
    And the label text "Real-time collaboration" is displayed in bold
    And the reasoning text is shown in italic below a subtle border
    And the score badge shows "9/10" with green styling

  # --- Error: no nodes on canvas ---
  Scenario: Image export fails gracefully when canvas is empty
    Given I have no nodes on the canvas
    When I trigger PNG export
    Then the export throws an error "No nodes to export"
    And no file download is initiated

  # --- Error: viewport not found ---
  Scenario: Image export fails when ReactFlow viewport is not mounted
    Given the ReactFlow canvas has not been rendered
    When I trigger PNG export
    Then the export throws an error "ReactFlow viewport not found"

  # --- Large tree ---
  Scenario: Image export handles a large tree with many nodes
    Given my tree has 80 nodes spread across 6 depth levels
    When I trigger PNG export
    Then getViewportForBounds computes a transform that fits all nodes with 100px padding
    And the zoom is clamped between 0.5 and 2
    And the resulting image dimensions scale with the computed bounds
    And the export completes without error
