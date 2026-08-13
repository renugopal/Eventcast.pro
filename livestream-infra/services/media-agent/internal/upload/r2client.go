package upload

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	smithy "github.com/aws/smithy-go"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

// R2Config configures R2Client. It is provider-agnostic S3-compatible
// configuration (04_TECH_STACK_AND_VERSION_POLICY.md "AWS SDK for Go v2
// is used for both R2 and Wasabi S3-compatible APIs with separate
// clients, endpoints, credentials, timeouts, and retry policies"); this
// struct is R2's client only.
type R2Config struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey logging.Secret
	// InsecureSkipVerify must stay false in production; it exists only
	// so isolated tests can point at a local S3-compatible container
	// using a self-signed certificate.
	InsecureSkipVerify bool
}

// S3Config is the provider-neutral alias of R2Config. The struct was
// already documented as provider-agnostic S3-compatible configuration;
// naming it explicitly lets a second endpoint (Backblaze B2's
// S3-compatible API, see internal/upload/b2archive.go) be constructed
// from the same proven code path instead of growing a second, divergent
// storage client.
type S3Config = R2Config

// R2Client is the production ObjectStore implementation: a thin wrapper
// over the S3-compatible API, used for live Cloudflare R2 traffic, for
// Backblaze B2 archival, and (pointed at a local pinned MinIO container)
// the integration-test proof. One client type, one code path, several
// independently-configured instances - never several storage
// architectures.
type R2Client struct {
	client *s3.Client
	bucket string
}

// NewS3CompatibleClient builds a client for any S3-compatible endpoint
// from cfg. NewR2Client is the R2-named wrapper retained so every
// existing caller and test is untouched; B2 archival calls this directly.
func NewS3CompatibleClient(cfg S3Config) (*R2Client, error) {
	return NewR2Client(cfg)
}

// NewR2Client builds an R2Client from cfg. It performs no network I/O;
// invalid endpoint URLs surface on the first request instead, since the
// AWS SDK v2 client construction itself does not dial out.
func NewR2Client(cfg R2Config) (*R2Client, error) {
	if cfg.Endpoint == "" || cfg.Bucket == "" || cfg.AccessKeyID == "" || cfg.SecretAccessKey.Reveal() == "" {
		return nil, fmt.Errorf("upload: R2Config is missing a required field")
	}

	var httpClient *http.Client
	if cfg.InsecureSkipVerify {
		httpClient = &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	}

	loadOpts := []func(*awsconfig.LoadOptions) error{
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID, cfg.SecretAccessKey.Reveal(), "")),
	}
	if httpClient != nil {
		loadOpts = append(loadOpts, awsconfig.WithHTTPClient(httpClient))
	}

	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(), loadOpts...)
	if err != nil {
		return nil, fmt.Errorf("upload: load AWS config: %w", err)
	}

	endpoint := cfg.Endpoint
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		// R2 (and most self-hosted S3-compatible services, including the
		// MinIO container the integration test uses) requires path-style
		// addressing; virtual-hosted-style depends on wildcard DNS this
		// deployment does not have.
		o.UsePathStyle = true
	})

	return &R2Client{client: client, bucket: cfg.Bucket}, nil
}

// PutObject implements ObjectStore.
func (c *R2Client) PutObject(ctx context.Context, in PutObjectInput) error {
	_, err := c.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(c.bucket),
		Key:           aws.String(in.Key),
		Body:          in.Body,
		ContentLength: aws.Int64(in.Size),
		ContentType:   aws.String(in.ContentType),
		CacheControl:  nonEmptyOrNil(in.CacheControl),
		Metadata:      in.Metadata,
		// Left nil unless the caller explicitly opted in. No production
		// path sets this today - see PutObjectInput.ChecksumSHA256.
		ChecksumSHA256: nonEmptyOrNil(in.ChecksumSHA256),
	})
	if err != nil {
		return fmt.Errorf("upload: put object %s: %w", in.Key, err)
	}
	return nil
}

// HeadObject implements ObjectStore.
func (c *R2Client) HeadObject(ctx context.Context, key string) (ObjectInfo, error) {
	out, err := c.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if isNotFound(err) {
			return ObjectInfo{}, fmt.Errorf("%w: %s", ErrObjectNotFound, key)
		}
		return ObjectInfo{}, fmt.Errorf("upload: head object %s: %w", key, err)
	}

	info := ObjectInfo{Exists: true, Metadata: out.Metadata}
	if out.ContentLength != nil {
		info.Size = *out.ContentLength
	}
	if out.ContentType != nil {
		info.ContentType = *out.ContentType
	}
	return info, nil
}

// GetObject implements ObjectStore. The caller owns the returned body and
// must Close it.
func (c *R2Client) GetObject(ctx context.Context, key string) (io.ReadCloser, error) {
	out, err := c.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if isNotFound(err) {
			return nil, fmt.Errorf("%w: %s", ErrObjectNotFound, key)
		}
		return nil, fmt.Errorf("upload: get object %s: %w", key, err)
	}
	return out.Body, nil
}

// isNotFound reports whether err represents a 404 from HeadObject. S3
// HeadObject responses carry no body, so the SDK cannot unmarshal a
// provider-specific modeled error type; it surfaces either as a generic
// smithy API error whose code is "NotFound" or as a response error
// whose underlying HTTP status is 404. Checking both forms keeps this
// correct across S3-compatible provider quirks without depending on one
// specific SDK error shape.
func isNotFound(err error) bool {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) && (apiErr.ErrorCode() == "NotFound" || apiErr.ErrorCode() == "404") {
		return true
	}
	var httpErr interface{ HTTPStatusCode() int }
	if errors.As(err, &httpErr) && httpErr.HTTPStatusCode() == http.StatusNotFound {
		return true
	}
	return false
}

func nonEmptyOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return aws.String(s)
}
