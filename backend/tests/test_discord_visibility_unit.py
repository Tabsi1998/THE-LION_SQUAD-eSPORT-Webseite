import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from discord_service import should_post_to_public_discord


def test_public_visibility_can_post_to_discord():
    assert should_post_to_public_discord({"visibility": "public"}) is True
    assert should_post_to_public_discord({"visibility": "community"}) is True


def test_member_and_internal_visibility_do_not_post_to_discord():
    assert should_post_to_public_discord({"visibility": "members"}) is False
    assert should_post_to_public_discord({"visibility": "internal"}) is False


def test_non_public_content_does_not_post_to_discord():
    assert should_post_to_public_discord({"visibility": "public", "is_public": False}) is False
