"""Tests for :func:`_classify_litellm_error` credential-chain detection.

Focus: AWS SSO / botocore credential-expiry errors that LiteLLM
wraps as ``APIConnectionError``. Before the fix, these classified
as ``api_connection`` (retryable) and the retry wrapper burned
11 attempts on an error that can only fail. They now classify
as ``authentication`` via the exception-chain walker or the
message-marker fallback, which is non-retryable.

The classifier takes a ``litellm_module`` argument used only to
look up its exception classes (``RateLimitError``, etc.). The
credential-chain walker runs BEFORE that lookup, so these tests
can pass a trivial stand-in module — any object whose attribute
access returns ``None`` works, because ``isinstance(exc, None)``
is ``False`` and the LiteLLM-class branches are all skipped.
"""

from __future__ import annotations

from types import SimpleNamespace

from ac_dc.llm._helpers import _classify_litellm_error


def _fake_litellm() -> SimpleNamespace:
    """Return a stand-in LiteLLM module with no exception classes.

    The classifier's ``_cls`` helper returns None for every
    lookup; each ``isinstance(exc, None)`` branch is skipped.
    The credential-chain walker runs first and returns before
    the LiteLLM-class branches are reached.
    """
    return SimpleNamespace(exceptions=SimpleNamespace())


class TestSSOTokenLoadError:
    """The specific error reported by the user after ``aws sso logout``."""

    def test_bare_exception_classifies_as_authentication(self) -> None:
        class SSOTokenLoadError(Exception):
            pass

        exc = SSOTokenLoadError(
            "Error loading SSO Token: Token for default does not exist"
        )
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"

    def test_message_surfaces_real_cause(self) -> None:
        class SSOTokenLoadError(Exception):
            pass

        exc = SSOTokenLoadError(
            "Error loading SSO Token: Token for default does not exist"
        )
        info = _classify_litellm_error(_fake_litellm(), exc)
        # Prefer the credential error's own message over whatever
        # LiteLLM wrapper the classifier received, so the toast
        # tells the user *why* auth failed.
        assert "Token for default does not exist" in info["message"]

    def test_wrapped_via_cause_chain_classifies_as_authentication(self) -> None:
        """LiteLLM's Bedrock path wraps botocore errors as APIConnectionError.

        The chain walker follows ``__cause__`` until it finds the real
        credential exception by class name.
        """
        class SSOTokenLoadError(Exception):
            pass

        class APIConnectionError(Exception):
            pass

        root = SSOTokenLoadError("Token for default does not exist")
        wrapper = APIConnectionError("litellm.APIConnectionError: ...")
        try:
            try:
                raise root
            except SSOTokenLoadError:
                raise wrapper
        except APIConnectionError as exc:
            caught = exc

        info = _classify_litellm_error(_fake_litellm(), caught)
        assert info["error_type"] == "authentication"

    def test_string_marker_fallback_when_chain_is_wiped(self) -> None:
        """LiteLLM sometimes re-raises with ``raise ... from None``.

        That wipes ``__cause__``. The message-marker fallback is the
        safety net: if the stringified exception mentions a known
        credential marker, we still classify as ``authentication``.
        """
        class APIConnectionError(Exception):
            pass

        exc = APIConnectionError(
            "litellm.APIConnectionError: Error loading SSO Token: "
            "Token for default does not exist"
        )
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"


class TestOtherCredentialErrors:
    """Other credential-chain exception names we classify."""

    def test_token_retrieval_error(self) -> None:
        class TokenRetrievalError(Exception):
            pass

        exc = TokenRetrievalError("Refreshing token failed")
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"

    def test_no_credentials_error(self) -> None:
        class NoCredentialsError(Exception):
            pass

        exc = NoCredentialsError("Unable to locate credentials")
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"

    def test_expired_token_exception(self) -> None:
        class ExpiredTokenException(Exception):
            pass

        exc = ExpiredTokenException(
            "The security token included in the request is expired"
        )
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"


class TestNonCredentialErrorsUnaffected:
    """Errors that don't match any credential marker fall through.

    Without a LiteLLM module carrying the real exception classes,
    these end up as ``llm_error`` — the catch-all. The important
    property is that they do NOT falsely classify as
    ``authentication``.
    """

    def test_generic_exception_is_not_authentication(self) -> None:
        exc = RuntimeError("something else broke")
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] != "authentication"

    def test_unrelated_api_connection_is_not_authentication(self) -> None:
        class APIConnectionError(Exception):
            pass

        exc = APIConnectionError("connection refused")
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] != "authentication"


class TestBedrockMarketplaceErrors:
    """Bedrock IAM / Marketplace authorization failures.

    LiteLLM wraps these as ``APIConnectionError`` ("BedrockException")
    but they're permanent permission errors — no IAM policy is going
    to materialise during a 60s backoff window. Classifying as
    ``authentication`` (non-retryable) ensures the retry loop bails
    out instead of burning 11 attempts, and the UI toast points the
    user at IAM / Marketplace settings rather than suggesting a
    transient network blip.

    The reproduction case is the user's screenshot: BedrockException
    JSON body containing "Model access is denied due to IAM" and
    explicit ``aws-marketplace:Subscribe`` / ``ViewSubscriptions``
    permission names.
    """

    def test_iam_denial_marker_classifies_as_authentication(self) -> None:
        """The exact marker string from the user-reported error."""
        class APIConnectionError(Exception):
            pass

        exc = APIConnectionError(
            'BedrockException - b\'{"message":"Model access is denied '
            'due to IAM user or service role is not authorized to '
            'perform the required AWS Marketplace actions '
            '(aws-marketplace:ViewSubscriptions, '
            'aws-marketplace:Subscribe) to enable access to this '
            'model."}\''
        )
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"

    def test_marketplace_subscribe_marker(self) -> None:
        class APIConnectionError(Exception):
            pass

        exc = APIConnectionError(
            "litellm wrapper: missing aws-marketplace:Subscribe permission"
        )
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"

    def test_marketplace_view_subscriptions_marker(self) -> None:
        class APIConnectionError(Exception):
            pass

        exc = APIConnectionError(
            "missing aws-marketplace:ViewSubscriptions"
        )
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"

    def test_aws_marketplace_subscription_marker(self) -> None:
        """Some error variants reference the subscription itself."""
        class APIConnectionError(Exception):
            pass

        exc = APIConnectionError(
            "Your AWS Marketplace subscription for this model "
            "cannot be completed at this time."
        )
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"

    def test_access_denied_exception_marker(self) -> None:
        """Bedrock surfaces ``AccessDeniedException`` for IAM denials."""
        class APIConnectionError(Exception):
            pass

        exc = APIConnectionError(
            "BedrockException - AccessDeniedException: User: "
            "arn:aws:iam::123:role/foo is not authorized to perform: "
            "bedrock:InvokeModel"
        )
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"

    def test_message_surfaces_real_cause(self) -> None:
        """Toast should show the IAM detail, not the LiteLLM wrapper."""
        class APIConnectionError(Exception):
            pass

        exc = APIConnectionError(
            "litellm.APIConnectionError: BedrockException - "
            "Model access is denied due to IAM user or service "
            "role is not authorized"
        )
        info = _classify_litellm_error(_fake_litellm(), exc)
        assert info["error_type"] == "authentication"
        # The classifier extracts the sentence around the marker
        # rather than passing through LiteLLM's whole wrapper.
        assert "Model access is denied due to IAM" in info["message"]