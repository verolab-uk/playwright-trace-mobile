Feature: Compact trace screencasts
  After the tests run, remove repeated screenshots from the screencast so the
  report opens faster on a phone, without losing any frame that shows a change.

  Scenario: A still screen keeps only one of its repeated screenshots
    Given the screencast has a still screen with two nearly identical screenshots in a row
    When I compact the screencast
    Then only one screenshot of that stretch is left

  Scenario: Screenshots taken while pressing a button are all kept
    Given the screencast has two screenshots taken while I press a button
    When I compact the screencast
    Then both screenshots taken while pressing are still there

  Scenario: Two screenshots that differ by one line of text are both kept
    Given the screencast has two screenshots where the second one has one extra line of text
    When I compact the screencast
    Then both screenshots are still there

  Scenario: Two clearly different screenshots are both kept
    Given the screencast has two screenshots that look completely different
    When I compact the screencast
    Then both screenshots are still there
