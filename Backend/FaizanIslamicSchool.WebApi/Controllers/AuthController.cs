using Microsoft.AspNetCore.Mvc;
using FaizanIslamicSchool.Application.Interfaces;
using FaizanIslamicSchool.Application.DTOs;
using System.Threading.Tasks;

namespace FaizanIslamicSchool.WebApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly IAuthService _authService;

        public AuthController(IAuthService authService)
        {
            _authService = authService;
        }

        [HttpPost("login")]
        public async Task<ActionResult<AuthResponseDto>> Login([FromBody] LoginRequestDto loginDto)
        {
            try
            {
                var response = await _authService.LoginAsync(loginDto);
                if (response == null) return Unauthorized(new { message = "Invalid username or password" });
                return Ok(response);
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new { message = "An error occurred during login", detailed = ex.Message });
            }
        }

        [HttpPost("register")]
        public async Task<ActionResult<AuthResponseDto>> Register([FromBody] RegisterRequestDto registerDto)
        {
            try
            {
                var response = await _authService.RegisterAsync(registerDto);
                return Ok(response);
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new { message = "An error occurred during registration", detailed = ex.Message });
            }
        }

        [HttpGet("me/{username}")]
        public async Task<ActionResult<UserDto>> GetMe(string username)
        {
            var user = await _authService.GetCurrentUserAsync(username);
            if (user == null) return NotFound();
            return Ok(user);
        }
    }
}
