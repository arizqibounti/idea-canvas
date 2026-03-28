# Domain: learning
# Capability: AI-crafted mnemonic video generation (Claude prompt craft + Veo 3 / ComfyUI video gen)
# Source: server/engine/mnemonic.js, client/src/useMnemonicVideo.js, client/src/chat/LearnCard.js

Feature: Mnemonic video generation
  As a learner I want AI-generated visual mnemonics for concepts
  so that I can watch a short video that makes abstract ideas tangible and memorable

  Background:
    Given I am logged in
    And I have an active session in "learn" mode
    And the concept DAG contains a concept node:
      | id        | type    | label            | difficulty | parentIds  |
      | concept_2 | concept | Gradient Descent | 5          | concept_1  |
    And the learn loop has produced teachContent with example and analogy for "concept_2"

  # --- Happy path: Veo 3 backend ---
  Scenario: Generate a mnemonic video using Veo 3
    Given the video backend is "veo"
    When I click "Visualize This Example" on the teaching card for "concept_2"
    Then the client calls POST /api/learn/mnemonic/generate with nodeId "concept_2", topic, nodes, example, and analogy
    And Claude crafts a veoPrompt describing a 6-second realistic video scene
    And the server starts Veo 3 video generation with model "veo-3.0-generate-001", aspect ratio "16:9", and duration 6 seconds
    And the server returns a jobId with status "pending", mnemonicStrategy, veoPrompt, and briefDescription
    And the LearnCard shows "Generating visual mnemonic..." with a pulsing indicator

  # --- ComfyUI / Wan 2.2 backend ---
  Scenario: Generate a mnemonic video using local ComfyUI backend
    Given the video backend is "comfyui"
    And ComfyUI is running and healthy at the configured URL
    When I click "Visualize This Example" on the teaching card for "concept_2"
    Then the server submits a Wan 2.2 text-to-video workflow to ComfyUI with 832x480 resolution and 81 frames at 16fps
    And the server returns a jobId with status "pending"

  # --- Auto backend selection ---
  Scenario: Auto backend falls back to Veo when ComfyUI is unavailable
    Given the video backend is "auto"
    And ComfyUI health check fails (timeout after 2 seconds)
    When I click "Visualize This Example"
    Then the server falls back to Veo 3 for video generation

  # --- Poll-based status checking ---
  Scenario: Client polls for video completion every 10 seconds
    Given a mnemonic job is in "polling" status for node "concept_2"
    Then the client polls POST /api/learn/mnemonic/poll with the jobId every 10 seconds
    When the server returns status "pending"
    Then polling continues
    When the server returns status "complete" with a videoUrl
    Then the polling interval is cleared
    And the mnemonicJob status for "concept_2" is updated to "complete" with the videoUrl

  # --- Veo 3 completion and GCS upload ---
  Scenario: Veo 3 video completes and is uploaded to GCS
    Given a Veo 3 operation is pending for jobId "mnemonic_concept_2_1711612800000"
    When the poll detects operation.done is true
    Then the server downloads the generated video to a temp file
    And uploads it to GCS bucket "lasttouchashar-mnemonics" as an MP4
    And makes the file publicly readable
    And cleans up the temp file
    And returns status "complete" with videoUrl "https://storage.googleapis.com/lasttouchashar-mnemonics/mnemonic_concept_2_1711612800000.mp4"

  # --- ComfyUI completion and GCS upload ---
  Scenario: ComfyUI video completes and is uploaded to GCS
    Given a ComfyUI job is pending with a promptId
    When comfyuiPollResult returns a WEBP output file
    Then the server downloads the file from ComfyUI
    And uploads it to GCS bucket "lasttouchashar-mnemonics" as a WEBP
    And returns status "complete" with a public videoUrl

  # --- Video display in LearnCard ---
  Scenario: Completed video plays inline in the teaching card
    Given mnemonic job for "concept_2" has status "complete" with a videoUrl
    Then the LearnCard renders a video element with autoPlay, loop, playsInline, and controls
    And the briefDescription is displayed above the video

  # --- Cached result on re-poll ---
  Scenario: Re-polling a completed job returns cached videoUrl
    Given jobId "mnemonic_concept_2_1711612800000" already has a cached videoUrl
    When the client polls the same jobId again
    Then the server returns the cached videoUrl immediately without re-downloading

  # --- Polling timeout ---
  Scenario: Video generation times out after 7 minutes
    Given a mnemonic job has been polling for node "concept_2" for over 7 minutes
    When the next poll interval fires
    Then the polling interval is cleared
    And the mnemonicJob status is set to "error" with message "Video generation timed out (7 minutes). Try again."

  # --- Error: Claude fails to generate veoPrompt ---
  Scenario: Generation fails when Claude does not return a veoPrompt
    Given Claude returns a response without a veoPrompt field
    When the server tries to parse the prompt craft result
    Then the server returns HTTP 500 with error "Claude did not generate a veoPrompt"
    And the client sets the mnemonicJob status to "error" for that node

  # --- Error: missing parameters ---
  Scenario: Server rejects generate request with missing nodeId
    When POST /api/learn/mnemonic/generate is called without a nodeId
    Then the server returns HTTP 400 with error "nodeId, topic, and nodes are required"

  # --- Error: unknown job on poll ---
  Scenario: Polling an expired or unknown jobId returns 404
    When POST /api/learn/mnemonic/poll is called with jobId "nonexistent_job_123"
    Then the server returns HTTP 404 with error "Job not found or expired"

  # --- Cancel mnemonic ---
  Scenario: Cancelling a mnemonic generation stops polling
    Given a mnemonic job is in "polling" status for node "concept_2"
    When cancelMnemonic is called for "concept_2"
    Then the polling interval for "concept_2" is cleared
    And the mnemonicJob entry for "concept_2" is removed from state

  # --- Stale job cleanup ---
  Scenario: Server cleans up stale jobs older than 2 hours
    Given a mnemonic job was created more than 2 hours ago
    When the hourly cleanup interval fires
    Then the stale job is removed from the pendingJobs map
